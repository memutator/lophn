// 삭제 시 의미적 cascade(clean_up: none|now|later)와 release.activate 사후 계약 변경 cascade 인계 조립.
// 1단 결정적 정리 뒤 영향받는 그릇마다 open follow_up_item(origin: "cascade")을 기록하고,
// 즉시 인계 대상이면 단일 그릇은 그 그릇 lophn으로, 복수 그릇은 Home lophn으로 handoff 메시지를 보낸다.
import {
  type Clock,
  createIdSource,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import { appDelete } from "../../../../protocol/apps/mod.ts";
import {
  type CleanUpMode,
  type DeclaredRef,
  type ErasedJobSpec,
  type FollowUpItem,
  type FollowUpWorkspace,
  type Id,
  type MentionedRef,
  parseActor,
} from "../../../../protocol/base/mod.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import type { CallPolicy } from "../../../../protocol/lophn-agent/call-policy.ts";
import type { ImpactTarget } from "../../../../protocol/lophn-agent/follow-ups.ts";
import {
  agentDelete,
  lophnIdOf,
  sendMessage,
  textBlocks,
  workspaceSessionOpen,
} from "../../../../protocol/lophn-agent/mod.ts";
import { artifactsDelete } from "../../../../protocol/projects/artifact-api.ts";
import type {
  AuthenticatedContext,
  Sql,
} from "../../../../protocol/server/mod.ts";
import { workflowDelete } from "../../../../protocol/workflows/routes.ts";
import type { ContractChangedInfo } from "../../../apps/releases/activation/orchestrator.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import type { Bus } from "../../../events/ports.ts";
import { insertFollowUp } from "../../../follow-ups/mod.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import { openConnection, type Writer } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";
import {
  type ImpactReadResult,
  type Receivers,
  receiversOf,
  scanImpact,
  scanReleaseContractUsers,
} from "./workspace-reader.ts";
import { createSkillDeployments } from "./skill-deploy.ts";

export const CASCADE_DELIVERY_PRINCIPAL = "machine:cascade-delivery";

// 삭제 확인 창·사후 계약 인계에서 대상 그릇 lophn에게 후속 정리 메시지를 넣는 core 안 자격.
// 사람의 삭제·동의 확정 행위 안에서만 호출된다(event.md 불변식 3).
export const CASCADE_DELIVERY_CONTEXT: AuthenticatedContext = {
  principal: CASCADE_DELIVERY_PRINCIPAL,
  actor: "user",
  scope: {
    operations: [workspaceSessionOpen.name, sendMessage.name],
    targets: {},
  },
  conditions: {},
  credential_ref: CASCADE_DELIVERY_PRINCIPAL,
};

const MEMORY_AND_LOPHN_INSTRUCTION =
  "Memory & guidance cleanup: Update `memory.md` (in this workspace and Home, if any notes mention this target) and any generated skills directly, then report what you changed. For `LOPHN.md`, ONLY propose changes to the person — never edit `LOPHN.md` automatically.";

const PHASE4_WORKFLOW_NOTE =
  "Running workflows note: Updating `workflow.yaml` or `flow.ts` does not alter already-running Phase 4 workflow instances (they keep their start-time `code_snapshot`). If any instance is `blocked`, tell the person they can continue it with `[Resume with updated code]`.";

type WorkspaceGroup = {
  key: string;
  workspace: FollowUpWorkspace | null;
  workspace_name: string;
  declared: DeclaredRef[];
  mentioned: MentionedRef[];
};

export type CascadeDeps = {
  ledgerPath: string;
  dataRoot: string;
  clock: Clock;
  ids: IdSource;
  bus: Pick<Bus, "publish">;
  writer: () => Writer;
  callPolicy?: () => CallPolicy | undefined;
  secretNames?: () => readonly string[];
  receivers?: Receivers;
};

export type CascadeResult = {
  follow_ups: FollowUpItem[];
  handoff_session: Id<"ses"> | null;
};

function workspaceKey(workspace: FollowUpWorkspace | null): string {
  return workspace === null ? "home" : `${workspace.kind}:${workspace.id}`;
}

function hasTable(sql: Pick<Sql, "get">, name: string): boolean {
  return (
    sql.get(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
    ) !== undefined
  );
}

// 요청에 clean_up이 있으면 그대로 쓰고, 생략된 경우 agent가 삭제했고 영향이 있으면 "later", 아니면 "none"이다.
export function resolveCleanUpMode(
  requested: CleanUpMode | undefined,
  actorHeader: string,
  impactCount: number,
): CleanUpMode {
  if (requested !== undefined) return requested;
  if (parseActor(actorHeader)?.kind === "agent" && impactCount > 0) {
    return "later";
  }
  return "none";
}

function sourceRefOf(target: ImpactTarget): string {
  switch (target.kind) {
    case "app":
      return `app:${target.app}`;
    case "agent":
      return `agent:${target.agent}`;
    case "artifact":
      return `artifact:${target.workspace.kind}:${target.workspace.id}/${target.name}`;
    case "workflow":
      return `workflow:${target.project}/${target.name}`;
  }
}

function groupByWorkspace(
  declared: readonly DeclaredRef[],
  mentioned: readonly MentionedRef[],
): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();
  const ensure = (
    workspace: FollowUpWorkspace | null,
    workspace_name: string,
  ): WorkspaceGroup => {
    const key = workspaceKey(workspace);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        key,
        workspace,
        workspace_name,
        declared: [],
        mentioned: [],
      };
      groups.set(key, group);
    }
    return group;
  };
  for (const ref of declared) {
    ensure(ref.workspace, ref.workspace_name).declared.push(ref);
  }
  for (const ref of mentioned) {
    ensure(ref.workspace, ref.workspace_name).mentioned.push(ref);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function formatReportCommand(id: string): string {
  return `lophn follow-up report ${id} --state done|changed|skipped --outcome "<one-line summary>"`;
}

function appendCommonSections(
  lines: string[],
  input: {
    immediate?: readonly string[];
    erasedJobs?: readonly ErasedJobSpec[];
    declared: readonly DeclaredRef[];
    mentioned: readonly MentionedRef[];
  },
): void {
  if (input.immediate && input.immediate.length > 0) {
    lines.push("", "Immediate deterministic deletions:");
    for (const item of input.immediate) {
      lines.push(`- ${item}`);
    }
  }
  if (input.erasedJobs && input.erasedJobs.length > 0) {
    lines.push(
      "",
      "Erased jobs (review whether replacement jobs should be created):",
    );
    for (const job of input.erasedJobs) {
      lines.push(`- ${job.id} (${job.title}): ${job.summary}`);
    }
  }
  if (input.declared.length > 0) {
    lines.push("", "Confirmed declared references to update:");
    for (const ref of input.declared) {
      lines.push(
        `- [${ref.kind}] (${ref.workspace_name}) ${ref.label} — ${ref.detail}`,
      );
    }
  }
  if (input.mentioned.length > 0) {
    lines.push(
      "",
      "Mentioned candidates to verify (flow.ts literals, skills/*/SKILL.md):",
    );
    for (const ref of input.mentioned) {
      lines.push(
        `- [${ref.kind}] (${ref.workspace_name}) ${ref.file}: ${ref.excerpt}`,
      );
    }
  }
  lines.push("", MEMORY_AND_LOPHN_INSTRUCTION, "", PHASE4_WORKFLOW_NOTE);
}

export function buildDeleteHandoffBody(input: {
  target: ImpactTarget;
  targetLabel: string;
  immediate: readonly string[];
  erasedJobs: readonly ErasedJobSpec[];
  group: WorkspaceGroup;
  followUpId: string;
}): string {
  const lines = [
    `Cascade cleanup after deleting ${input.target.kind} "${input.targetLabel}" (workspace: ${input.group.workspace_name}).`,
  ];
  appendCommonSections(lines, {
    immediate: input.immediate,
    erasedJobs: input.erasedJobs,
    declared: input.group.declared,
    mentioned: input.group.mentioned,
  });
  lines.push(
    "",
    "When finished, report this follow-up item:",
    `\`${formatReportCommand(input.followUpId)}\``,
  );
  return lines.join("\n");
}

function buildMultiWorkspaceDeleteHandoffBody(input: {
  target: ImpactTarget;
  targetLabel: string;
  immediate: readonly string[];
  erasedJobs: readonly ErasedJobSpec[];
  items: readonly { group: WorkspaceGroup; item: FollowUpItem }[];
}): string {
  const lines = [
    `Multi-workspace cascade cleanup after deleting ${input.target.kind} "${input.targetLabel}".`,
    "Impacts span multiple workspaces. Coordinate replacements and delegate each workspace's cleanup to its lophn.",
  ];
  appendCommonSections(lines, {
    immediate: input.immediate,
    erasedJobs: input.erasedJobs,
    declared: input.items.flatMap((entry) => entry.group.declared),
    mentioned: input.items.flatMap((entry) => entry.group.mentioned),
  });
  lines.push("", "Created follow-up items (report each when finished):");
  for (const entry of input.items) {
    lines.push(
      `- ${entry.item.id} (${entry.group.workspace_name}): \`${formatReportCommand(entry.item.id)}\``,
    );
  }
  return lines.join("\n");
}

export function buildContractChangeHandoffBody(input: {
  appSlug: string;
  appName: string;
  previousRelease: Id<"rel">;
  nextRelease: Id<"rel">;
  changes: readonly { surface: string; name: string; change: string }[];
  workspaceName: string;
  reasons: readonly string[];
  declared: readonly DeclaredRef[];
  mentioned: readonly MentionedRef[];
  followUpId: string;
}): string {
  const lines = [
    `Post-activation contract cascade for app "${input.appName}" (${input.appSlug}): release ${input.previousRelease} -> ${input.nextRelease} (workspace: ${input.workspaceName}).`,
    "",
    "Changed or removed public contracts:",
    ...input.changes.map((c) => `- [${c.surface}] ${c.name}: ${c.change}`),
  ];
  if (input.reasons.length > 0) {
    lines.push("", "Why this workspace is affected:");
    for (const reason of input.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  appendCommonSections(lines, {
    declared: input.declared,
    mentioned: input.mentioned,
  });
  lines.push(
    "",
    "When finished, report this follow-up item:",
    `\`${formatReportCommand(input.followUpId)}\``,
  );
  return lines.join("\n");
}

function buildMultiWorkspaceContractHandoffBody(input: {
  appSlug: string;
  appName: string;
  previousRelease: Id<"rel">;
  nextRelease: Id<"rel">;
  changes: readonly { surface: string; name: string; change: string }[];
  declared: readonly DeclaredRef[];
  mentioned: readonly MentionedRef[];
  items: readonly { workspaceName: string; item: FollowUpItem }[];
}): string {
  const lines = [
    `Multi-workspace post-activation contract cascade for app "${input.appName}" (${input.appSlug}): release ${input.previousRelease} -> ${input.nextRelease}.`,
    "Multiple downstream workspaces are affected. Coordinate updates and delegate per-workspace changes to each workspace's lophn.",
    "",
    "Changed or removed public contracts:",
    ...input.changes.map((c) => `- [${c.surface}] ${c.name}: ${c.change}`),
  ];
  appendCommonSections(lines, {
    declared: input.declared,
    mentioned: input.mentioned,
  });
  lines.push("", "Created follow-up items (report each when finished):");
  for (const entry of input.items) {
    lines.push(
      `- ${entry.item.id} (${entry.workspaceName}): \`${formatReportCommand(entry.item.id)}\``,
    );
  }
  return lines.join("\n");
}

function findOpenLophnSession(
  ledgerPath: string,
  workspace: FollowUpWorkspace | null,
): Id<"ses"> | null {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return null;
  try {
    const { sql } = opened.value;
    if (!hasTable(sql, "sessions")) return null;
    const agent = lophnIdOf(workspace);
    const row =
      workspace === null
        ? sql.get(
            `SELECT id FROM sessions
             WHERE agent = ? AND place_kind IS NULL AND lifecycle = 'open'
             ORDER BY state_seq DESC, created_seq DESC
             LIMIT 1`,
            [agent],
          )
        : sql.get(
            `SELECT id FROM sessions
             WHERE agent = ? AND place_kind = ? AND place_id = ? AND lifecycle = 'open'
             ORDER BY state_seq DESC, created_seq DESC
             LIMIT 1`,
            [agent, workspace.kind, workspace.id],
          );
    return row === undefined ? null : (String(row["id"]) as Id<"ses">);
  } catch {
    return null;
  } finally {
    opened.value.close();
  }
}

async function deliverToWorkspaceLophn(
  deps: CascadeDeps,
  workspace: FollowUpWorkspace | null,
  text: string,
): Promise<Result<Id<"ses">>> {
  const writer = deps.writer();
  let sessionId = findOpenLophnSession(deps.ledgerPath, workspace);
  if (sessionId === null) {
    const candidate = deps.ids.newId("ses") as Id<"ses">;
    const opened = await writer.command(CASCADE_DELIVERY_CONTEXT, {
      command: workspaceSessionOpen.name,
      input: {
        id: candidate,
        agent: lophnIdOf(workspace),
        workspace,
      },
      idempotency_key: crypto.randomUUID(),
      compare: {},
      prepared: [],
    });
    if (!opened.ok) return opened;
    const returned = (opened.value.result as { id?: unknown } | null)?.id;
    sessionId = (
      typeof returned === "string" ? returned : candidate
    ) as Id<"ses">;
  }
  const sent = await writer.command(CASCADE_DELIVERY_CONTEXT, {
    command: sendMessage.name,
    input: {
      id: deps.ids.newId("msg"),
      session: sessionId,
      content: textBlocks(text),
      delivery: "next_turn",
      refs: [],
    },
    idempotency_key: crypto.randomUUID(),
    compare: {},
    prepared: [],
  });
  if (!sent.ok) return sent;
  return ok(sessionId);
}

function persistFollowUps(
  deps: CascadeDeps,
  entries: readonly {
    id: string;
    workspace: FollowUpWorkspace | null;
    source_ref: string | null;
    title: string;
    body: string;
  }[],
): Result<FollowUpItem[]> {
  if (entries.length === 0) return ok([]);
  const opened = openConnection(deps.ledgerPath);
  if (!opened.ok) return opened;
  try {
    const { sql } = opened.value;
    if (!hasTable(sql, "follow_up_items")) {
      return ok([]);
    }
    opened.value.exec("BEGIN IMMEDIATE");
    const tx = {
      sql,
      newId: (prefix: string) => deps.ids.newId(prefix),
      now: () => deps.clock.now(),
    };
    const items: FollowUpItem[] = [];
    for (const entry of entries) {
      items.push(
        insertFollowUp(tx, {
          id: entry.id,
          workspace: entry.workspace,
          origin: "cascade",
          source_ref: entry.source_ref,
          title: entry.title,
          body: entry.body,
        }),
      );
    }
    opened.value.exec("COMMIT");
    publishStateChanged(deps.bus, deps.clock.now(), [
      { name: "follow_ups", id: null },
    ]);
    return ok(items);
  } catch (thrown) {
    try {
      if (opened.value.inTransaction()) opened.value.exec("ROLLBACK");
    } catch {
      // ignore rollback error
    }
    return err({
      code: "unavailable",
      message: `could not insert cascade follow-up items: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    });
  } finally {
    opened.value.close();
  }
}

function summarizeJobRow(row: Record<string, unknown>): string {
  const every =
    row["every"] === null || row["every"] === undefined
      ? null
      : String(row["every"]);
  const at =
    row["at"] === null || row["at"] === undefined ? null : String(row["at"]);
  let cadence = "scheduled";
  if (every !== null) {
    cadence = at !== null ? `every ${every} at ${at}` : `every ${every}`;
  } else if (typeof row["trigger"] === "string") {
    try {
      const trigger = JSON.parse(row["trigger"]) as {
        source?: string;
        event?: string;
      };
      if (trigger.source && trigger.event) {
        cadence = `on ${trigger.source}.${trigger.event}`;
      }
    } catch {
      // keep fallback
    }
  }
  let actionDesc = "action";
  if (typeof row["action"] === "string") {
    try {
      const action = JSON.parse(row["action"]) as Record<string, unknown>;
      if (action["kind"] === "agent_run") {
        actionDesc = `agent ${String(action["agent"] ?? "")}`;
      } else if (action["kind"] === "tool_run") {
        actionDesc = `tool ${String(action["app"] ?? "")}.${String(action["tool"] ?? "")}`;
      } else if (action["kind"] === "workflow_start") {
        actionDesc = `workflow ${String(action["project"] ?? "")}/${String(action["workflow"] ?? "")}`;
      }
    } catch {
      // keep fallback
    }
  }
  return `${cadence} -> ${actionDesc}`;
}

function snapshotAppJobs(ledgerPath: string, appId: string): ErasedJobSpec[] {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return [];
  try {
    const { sql } = opened.value;
    if (!hasTable(sql, "jobs")) return [];
    const rows = sql.all(
      `SELECT id, title, every, at, trigger, action FROM jobs
       WHERE creator_workspace = ?1
          OR (json_extract(action, '$.kind') = 'tool_run' AND json_extract(action, '$.app') = ?1)
          OR (trigger IS NOT NULL
              AND json_extract(trigger, '$.source_machine') IS NULL
              AND json_extract(trigger, '$.app') = ?1)
       ORDER BY id`,
      [appId],
    );
    return rows.map((row) => ({
      id: String(row["id"]) as Id<"job">,
      title: String(row["title"]),
      summary: summarizeJobRow(row),
    }));
  } catch {
    return [];
  } finally {
    opened.value.close();
  }
}

function snapshotWorkflowJobs(
  ledgerPath: string,
  project: string,
  name: string,
): ErasedJobSpec[] {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return [];
  try {
    const { sql } = opened.value;
    if (!hasTable(sql, "jobs")) return [];
    const rows = sql.all(
      `SELECT id, title, every, at, trigger, action FROM jobs
       WHERE json_extract(action, '$.kind') = 'workflow_start'
         AND json_extract(action, '$.project') = ?1
         AND json_extract(action, '$.workflow') = ?2
       ORDER BY id`,
      [project, name],
    );
    return rows.map((row) => ({
      id: String(row["id"]) as Id<"job">,
      title: String(row["title"]),
      summary: summarizeJobRow(row),
    }));
  } catch {
    return [];
  } finally {
    opened.value.close();
  }
}

async function scanTargetImpact(
  deps: CascadeDeps,
  target: ImpactTarget,
): Promise<ImpactReadResult | null> {
  const opened = openConnection(deps.ledgerPath);
  if (!opened.ok) return null;
  try {
    const scanned = await scanImpact(
      {
        sql: opened.value.sql,
        dataRoot: deps.dataRoot,
        ...(deps.callPolicy ? { callPolicy: deps.callPolicy() } : {}),
        ...(deps.secretNames ? { secretNames: deps.secretNames } : {}),
        ...(deps.receivers ? { receivers: deps.receivers } : {}),
      },
      target,
    );
    return scanned.ok ? scanned.value : null;
  } catch {
    return null;
  } finally {
    opened.value.close();
  }
}

// 삭제 commit 성공 뒤 clean_up 정책에 따라 follow_up_items를 기록하고 필요하면 즉시 lophn으로 인계한다.
export async function runDeleteCascade(
  deps: CascadeDeps,
  input: {
    target: ImpactTarget;
    scanned: ImpactReadResult | null;
    requestedCleanUp: CleanUpMode | undefined;
    actor: string;
    erasedJobs?: readonly ErasedJobSpec[];
  },
): Promise<Result<CascadeResult>> {
  const scanned = input.scanned;
  if (scanned === null) {
    return ok({ follow_ups: [], handoff_session: null });
  }
  const impactCount =
    scanned.impact.declared.length + scanned.impact.mentioned.length;
  const mode = resolveCleanUpMode(
    input.requestedCleanUp,
    input.actor,
    impactCount,
  );
  if (mode === "none" || impactCount === 0) {
    return ok({ follow_ups: [], handoff_session: null });
  }

  const groups = groupByWorkspace(
    scanned.impact.declared,
    scanned.impact.mentioned,
  );
  if (groups.length === 0) {
    return ok({ follow_ups: [], handoff_session: null });
  }

  const sourceRef = sourceRefOf(input.target);
  const erasedJobs = input.erasedJobs ?? [];
  const planned = groups.map((group) => {
    const id = deps.ids.newId("fup");
    const title = `Clean up references to deleted ${input.target.kind} ${scanned.target_label}`;
    const body = buildDeleteHandoffBody({
      target: input.target,
      targetLabel: scanned.target_label,
      immediate: scanned.immediate,
      erasedJobs,
      group,
      followUpId: id,
    });
    return {
      group,
      entry: {
        id,
        workspace: group.workspace,
        source_ref: sourceRef,
        title,
        body,
      },
    };
  });

  const saved = persistFollowUps(
    deps,
    planned.map((p) => p.entry),
  );
  if (!saved.ok) return saved;
  const followUps = saved.value;

  let handoffSession: Id<"ses"> | null = null;
  if (mode === "now" && followUps.length > 0) {
    const targetWorkspace = groups.length === 1 ? groups[0].workspace : null;
    const messageText =
      groups.length === 1
        ? planned[0].entry.body
        : buildMultiWorkspaceDeleteHandoffBody({
            target: input.target,
            targetLabel: scanned.target_label,
            immediate: scanned.immediate,
            erasedJobs,
            items: planned.map((p, index) => ({
              group: p.group,
              item: followUps[index],
            })),
          });
    const delivered = await deliverToWorkspaceLophn(
      deps,
      targetWorkspace,
      messageText,
    );
    if (delivered.ok) {
      handoffSession = delivered.value;
    }
  }

  return ok({ follow_ups: followUps, handoff_session: handoffSession });
}

// release.activate 확정 뒤 공개 계약(command·skill·event) 변경·삭제를 하류 그릇에 사후 인계한다.
export async function runContractChangeCascade(
  deps: CascadeDeps,
  info: ContractChangedInfo,
): Promise<Result<CascadeResult>> {
  if (info.changes.length === 0) {
    return ok({ follow_ups: [], handoff_session: null });
  }
  const opened = openConnection(deps.ledgerPath);
  if (!opened.ok) return opened;
  let scanned;
  try {
    scanned = await scanReleaseContractUsers(
      opened.value.sql,
      deps.dataRoot,
      info.app,
      info.changes,
      deps.receivers,
    );
  } finally {
    opened.value.close();
  }
  if (!scanned.ok) return scanned;
  const impact = scanned.value;
  if (impact.affected_workspaces.length === 0) {
    return ok({ follow_ups: [], handoff_session: null });
  }

  const sourceRef = `release:${info.app}:${info.nextRelease}`;
  const planned = impact.affected_workspaces.map((affected) => {
    const key = workspaceKey(affected.workspace);
    const wsDeclared = impact.declared.filter(
      (ref) => workspaceKey(ref.workspace) === key,
    );
    const wsMentioned = impact.mentioned.filter(
      (ref) => workspaceKey(ref.workspace) === key,
    );
    const id = deps.ids.newId("fup");
    const title = `Adapt to contract changes in ${impact.app_name} (${impact.slug})`;
    const body = buildContractChangeHandoffBody({
      appSlug: impact.slug,
      appName: impact.app_name,
      previousRelease: info.previousRelease,
      nextRelease: info.nextRelease,
      changes: info.changes,
      workspaceName: affected.workspace_name,
      reasons: affected.reasons,
      declared: wsDeclared,
      mentioned: wsMentioned,
      followUpId: id,
    });
    return {
      affected,
      entry: {
        id,
        workspace: affected.workspace,
        source_ref: sourceRef,
        title,
        body,
      },
    };
  });

  const saved = persistFollowUps(
    deps,
    planned.map((p) => p.entry),
  );
  if (!saved.ok) return saved;
  const followUps = saved.value;

  let handoffSession: Id<"ses"> | null = null;
  if (followUps.length > 0) {
    const targetWorkspace =
      planned.length === 1 ? planned[0].affected.workspace : null;
    const messageText =
      planned.length === 1
        ? planned[0].entry.body
        : buildMultiWorkspaceContractHandoffBody({
            appSlug: impact.slug,
            appName: impact.app_name,
            previousRelease: info.previousRelease,
            nextRelease: info.nextRelease,
            changes: info.changes,
            declared: impact.declared,
            mentioned: impact.mentioned,
            items: planned.map((p, index) => ({
              workspaceName: p.affected.workspace_name,
              item: followUps[index],
            })),
          });
    const delivered = await deliverToWorkspaceLophn(
      deps,
      targetWorkspace,
      messageText,
    );
    if (delivered.ok) {
      handoffSession = delivered.value;
    }
  }

  return ok({ follow_ups: followUps, handoff_session: handoffSession });
}

function resolveWorkflowDeleteProject(
  ledgerPath: string,
  who: AuthenticatedContext,
  requested: string | undefined,
): Id<"prj"> | null {
  if (typeof requested === "string" && requested.startsWith("prj_")) {
    return requested as Id<"prj">;
  }
  if (typeof who.conditions.project === "string") {
    return who.conditions.project as Id<"prj">;
  }
  const sessionId = who.conditions.session;
  if (typeof sessionId === "string") {
    const opened = openConnection(ledgerPath);
    if (opened.ok) {
      try {
        const session = loadSession({ sql: opened.value.sql }, sessionId);
        const ws = session ? workspaceOf(session) : null;
        if (ws?.kind === "project") return ws.id as Id<"prj">;
      } catch {
        // ignore lookup error
      } finally {
        opened.value.close();
      }
    }
  }
  return null;
}

// artifacts/delete와 workflows/delete memory handler를 감싸 삭제 전 scanImpact → 삭제 성공 뒤 cascade 인계를 잇는다.
export function wrapCascadeMemoryHandlers(
  handlers: Map<string, MemoryHandler>,
  deps: CascadeDeps,
  onError?: (event: string, message: string) => void,
): void {
  const artifactKey = `${artifactsDelete.resource}/${artifactsDelete.method}`;
  const origArtifactDelete = handlers.get(artifactKey);
  if (origArtifactDelete !== undefined) {
    handlers.set(artifactKey, async (who, rawInput, credential) => {
      const parsed = artifactsDelete.input.safeParse(rawInput);
      const target: ImpactTarget | null = parsed.success
        ? {
            kind: "artifact",
            workspace:
              "project" in parsed.data
                ? { kind: "project", id: parsed.data.project }
                : { kind: "app", id: parsed.data.app },
            name: parsed.data.name,
          }
        : null;
      const scanned =
        target === null ? null : await scanTargetImpact(deps, target);
      const done = await origArtifactDelete(who, rawInput, credential);
      if (!done.ok || target === null || !parsed.success) return done;
      const cascaded = await runDeleteCascade(deps, {
        target,
        scanned,
        requestedCleanUp: parsed.data.clean_up,
        actor: who.actor,
      });
      if (!cascaded.ok) {
        onError?.("artifact_cascade_failed", cascaded.error.message);
        return done;
      }
      return ok({
        ...(done.value as Record<string, unknown>),
        follow_ups: cascaded.value.follow_ups,
        handoff_session: cascaded.value.handoff_session,
      });
    });
  }

  const workflowKey = `${workflowDelete.resource}/${workflowDelete.method}`;
  const origWorkflowDelete = handlers.get(workflowKey);
  if (origWorkflowDelete !== undefined) {
    handlers.set(workflowKey, async (who, rawInput, credential) => {
      const parsed = workflowDelete.input.safeParse(rawInput);
      const projectId = parsed.success
        ? resolveWorkflowDeleteProject(
            deps.ledgerPath,
            who,
            parsed.data.project,
          )
        : null;
      const target: ImpactTarget | null =
        parsed.success && projectId !== null
          ? { kind: "workflow", project: projectId, name: parsed.data.name }
          : null;
      const scanned =
        target === null ? null : await scanTargetImpact(deps, target);
      const erasedJobs =
        parsed.success && projectId !== null
          ? snapshotWorkflowJobs(deps.ledgerPath, projectId, parsed.data.name)
          : [];
      const done = await origWorkflowDelete(who, rawInput, credential);
      if (!done.ok || target === null || !parsed.success) return done;
      const cascaded = await runDeleteCascade(deps, {
        target,
        scanned,
        requestedCleanUp: parsed.data.clean_up,
        actor: who.actor,
        erasedJobs,
      });
      if (!cascaded.ok) {
        onError?.("workflow_cascade_failed", cascaded.error.message);
        return done;
      }
      return ok({
        ...(done.value as Record<string, unknown>),
        follow_ups: cascaded.value.follow_ups,
        handoff_session: cascaded.value.handoff_session,
      });
    });
  }
}

export function createDeleteCascadeWriter(
  inner: Writer,
  deps: CascadeDeps,
  onError?: (event: string, message: string) => void,
): Writer {
  return {
    ...inner,
    async command(auth, envelope) {
      if (envelope.command === appDelete.name) {
        const input = envelope.input as
          | { app?: unknown; clean_up?: CleanUpMode }
          | undefined;
        const appId =
          typeof input?.app === "string" ? (input.app as Id<"app">) : null;
        const target: ImpactTarget | null =
          appId === null ? null : { kind: "app", app: appId };
        const scanned =
          target === null ? null : await scanTargetImpact(deps, target);
        const erasedJobs =
          appId === null ? [] : snapshotAppJobs(deps.ledgerPath, appId);
        const done = await inner.command(auth, envelope);
        if (!done.ok || done.value.replayed || target === null) return done;
        const cascaded = await runDeleteCascade(deps, {
          target,
          scanned,
          requestedCleanUp: input?.clean_up,
          actor: auth.actor,
          erasedJobs,
        });
        if (!cascaded.ok) {
          onError?.("app_cascade_failed", cascaded.error.message);
          return done;
        }
        return ok({
          ...done.value,
          result: {
            ...(done.value.result as Record<string, unknown>),
            ...(erasedJobs.length > 0 ? { erased_jobs: erasedJobs } : {}),
            follow_ups: cascaded.value.follow_ups,
            handoff_session: cascaded.value.handoff_session,
          },
        });
      }

      if (envelope.command === agentDelete.name) {
        const input = envelope.input as
          | { agent?: unknown; clean_up?: CleanUpMode }
          | undefined;
        const agentId =
          typeof input?.agent === "string" && input.agent.startsWith("agt_")
            ? (input.agent as Id<"agt">)
            : null;
        const target: ImpactTarget | null =
          agentId === null ? null : { kind: "agent", agent: agentId };
        const scanned =
          target === null ? null : await scanTargetImpact(deps, target);
        const done = await inner.command(auth, envelope);
        if (!done.ok || done.value.replayed || target === null) return done;
        const orig = done.value.result as {
          erased_jobs?: ErasedJobSpec[];
        };
        const cascaded = await runDeleteCascade(deps, {
          target,
          scanned,
          requestedCleanUp: input?.clean_up,
          actor: auth.actor,
          erasedJobs: orig.erased_jobs ?? [],
        });
        if (!cascaded.ok) {
          onError?.("agent_cascade_failed", cascaded.error.message);
          return done;
        }
        return ok({
          ...done.value,
          result: {
            ...(done.value.result as Record<string, unknown>),
            follow_ups: cascaded.value.follow_ups,
            handoff_session: cascaded.value.handoff_session,
          },
        });
      }

      return await inner.command(auth, envelope);
    },
  };
}

export const cascadeWiring: WiringFactory = () => {
  let cascadeDeps: CascadeDeps | undefined;
  return {
    name: "cascade",
    records: () => [CASCADE_DELIVERY_CONTEXT],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const deps: CascadeDeps = {
        ledgerPath: ctx.ledgerPath,
        dataRoot: ctx.root.path,
        clock: ctx.clock,
        ids,
        bus: ctx.bus,
        writer: () => ctx.writer,
        callPolicy: () => ctx.peek.settings?.get(callPolicySetting),
        secretNames: () => {
          const names = ctx.peek.secretStore?.names();
          return names?.ok ? names.value : [];
        },
        receivers: receiversOf(ctx, (message) =>
          ctx.telemetry.logger.warn({
            component: "cascade",
            event: "receivers_not_read",
            fields: { message },
          }),
        ),
      };
      cascadeDeps = deps;
      const warn = (event: string, message: string) =>
        ctx.telemetry.logger.warn({
          component: "cascade",
          event,
          fields: { message },
        });
      return ok({
        writer: (inner) => createDeleteCascadeWriter(inner, deps, warn),
      });
    },
    start(ctx) {
      if (cascadeDeps !== undefined) {
        const warn = (event: string, message: string) =>
          ctx.telemetry.logger.warn({
            component: "cascade",
            event,
            fields: { message },
          });
        wrapCascadeMemoryHandlers(
          ctx.runtime.memory.handlers,
          cascadeDeps,
          warn,
        );
      }
      return Promise.resolve(ok(undefined));
    },
  };
};
