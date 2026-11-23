// 통합 작업 공간 업데이트(`update.status`, `update.decide`, `update.record`)와
// `workspace_update_needed` Inbox 알림 갱신을 조립한다.
import { readdir, readFile } from "node:fs/promises";
import {
  createIdSource,
  err,
  errorCode,
  type IdSource,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import type { NoticeRecordInput } from "../../../../protocol/apps/notice.ts";
import type { AppSdkStatus } from "../../../../protocol/apps/sdk-status.ts";
import {
  PLATFORM_NOTE_AREAS,
  type PlatformNoteSummary,
  type WorkflowFlowSdkStatus,
  workspaceUpdateDecide,
  workspaceUpdateRecord,
  workspaceUpdateStatus,
} from "../../../../protocol/apps/updates.ts";
import {
  type FollowUpWorkspace,
  type Id,
  parseActor,
} from "../../../../protocol/base/mod.ts";
import type {
  AuthenticatedContext,
  Input,
  Sql,
} from "../../../../protocol/server/mod.ts";
import { BUNDLED_SKILLS_ROOT } from "../../../agent-workspaces/skills/root.ts";
import { UPDATE_RECORD_CONTEXT } from "../../../apps/sdk-status/decide.ts";
import {
  recordWorkspaceUpdates,
  WORKSPACE_UPDATE_NOTICE_KEY,
} from "../../../apps/sdk-status/detect.ts";
import {
  compareVersion,
  readSdkStatus,
} from "../../../apps/sdk-status/status.ts";
import {
  listFollowUps,
  loadLastFlowSdkReview,
  loadLastPlatformReview,
} from "../../../follow-ups/mod.ts";
import {
  type BodyPrepare,
  redactBlocks,
} from "../../../lophn-agent/session/message-body.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import {
  type KnownSecretMatch,
  openConnection,
  type Writer,
} from "../../../storage/ledger/mod.ts";
import {
  DEFAULT_MISSING_FLOW_SDK,
  flowSdkStatusOf,
} from "../../../workflows/declaration.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";
import { prepareBodies } from "./router.ts";
import { readInstalledFlowSdkInfo } from "./workflows-files.ts";
import { readWorkspaceSnapshot } from "./workspace-reader.ts";

type Query = Pick<Sql, "get" | "all">;
type UpdateStatusOutput = typeof workspaceUpdateStatus.output._output;
type PreparedOperation = Input<
  typeof workspaceUpdateRecord
>["operations"][number];
type PreparedItem = {
  id: string;
  title: string;
  proposal: string;
  source_ref?: string;
};

const PLATFORM_BREAKING = /^Breaking:[ \t]*(yes|no)(?:$|[\s.,:;—–(-])/m;
const PLATFORM_AREAS_LINE = /^Areas:[ \t]*(.*)$/m;
const HEADING_LINE = /^#\s+(.+)$/m;
const FLOW_NOTE_FILE = /^flow-(\d+\.\d+\.\d+)\.md$/;
const PLATFORM_AREA_SET = new Set<string>(PLATFORM_NOTE_AREAS);

const OWNERSHIP_SPLIT_NOTE =
  "When cleaning up outdated workaround rules: edit agent-owned files (memory.md and generated skills) directly and report what you changed; for user-owned LOPHN.md, propose edits or removals only and do not edit it directly.";

function hasTable(sql: Query, name: string): boolean {
  return (
    sql.get(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
    ) !== undefined
  );
}

// P12 경계: update.status는 user·machine·Home agent만, update.decide는 user·Home agent만 부른다.
export function isUpdateActorAllowed(
  sql: Query,
  actorHeader: string,
  conditions: Readonly<Record<string, unknown>>,
  allowMachine: boolean,
): boolean {
  const actor = parseActor(actorHeader);
  if (actor === undefined) return false;
  if (actor.kind === "user") return true;
  if (allowMachine && actor.kind === "machine") return true;
  if (actor.kind !== "agent") return false;
  if (conditions["project"] !== undefined || conditions["app"] !== undefined) {
    return false;
  }
  const row = loadSession({ sql }, actor.id);
  if (row === undefined) return false;
  return workspaceOf(row) === null;
}

// `skills/update/platform-notes.json`과 `notes/<id>.md` 메타데이터를 읽는다. 파일이 없으면 빈 목록으로 물러난다.
export async function readPlatformNotes(
  skillsRoot = BUNDLED_SKILLS_ROOT,
): Promise<PlatformNoteSummary[]> {
  const manifestPath = `${skillsRoot}/update/platform-notes.json`;
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return [];
    throw cause;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids = parsed.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  const notes: PlatformNoteSummary[] = [];
  for (const id of ids) {
    const relPath = `notes/${id}.md`;
    let text = "";
    try {
      text = await readFile(`${skillsRoot}/update/${relPath}`, "utf8");
    } catch (cause) {
      if (errorCode(cause) !== "ENOENT") throw cause;
    }
    const breaking = PLATFORM_BREAKING.exec(text)?.[1] === "yes";
    const rawAreas = PLATFORM_AREAS_LINE.exec(text)?.[1]?.trim() ?? "";
    const parsedAreas = rawAreas
      .split(",")
      .map((part) => part.trim())
      .filter((area): area is PlatformNoteSummary["areas"][number] =>
        PLATFORM_AREA_SET.has(area),
      );
    const title = HEADING_LINE.exec(text)?.[1]?.trim() || id;
    notes.push({
      id,
      breaking,
      areas: parsedAreas.length > 0 ? parsedAreas : ["home"],
      title,
      note_path: relPath,
    });
  }
  return notes;
}

export function unreviewedPlatformNotes(
  allNotes: readonly PlatformNoteSummary[],
  through: string | null,
): PlatformNoteSummary[] {
  if (through === null) return [...allNotes];
  const at = allNotes.findIndex((note) => note.id === through);
  if (at === -1) return [...allNotes];
  return allNotes.slice(at + 1);
}

async function readFlowNoteVersions(notesRoot: string): Promise<string[]> {
  try {
    const files = await readdir(notesRoot);
    const versions: string[] = [];
    for (const file of files) {
      const matched = FLOW_NOTE_FILE.exec(file);
      if (matched !== null) versions.push(matched[1]);
    }
    return versions.sort(compareVersion);
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return [];
    throw cause;
  }
}

export type UpdateStatusDeps = {
  sql: Query;
  dataRoot: string;
  skillsRoot?: string;
};

export async function readUpdateStatus(
  deps: UpdateStatusDeps,
): Promise<Result<UpdateStatusOutput & { all_notes: PlatformNoteSummary[] }>> {
  const skillsRoot = deps.skillsRoot ?? BUNDLED_SKILLS_ROOT;
  const notesRoot = `${skillsRoot}/migrate-sdk`;
  const [appsResult, snapshotResult, flowInfo, flowNoteVersions, allNotes] =
    await Promise.all([
      readSdkStatus({ dataRoot: deps.dataRoot, notesRoot, sql: deps.sql }),
      readWorkspaceSnapshot({ sql: deps.sql, dataRoot: deps.dataRoot }),
      readInstalledFlowSdkInfo(deps.dataRoot),
      readFlowNoteVersions(notesRoot),
      readPlatformNotes(skillsRoot),
    ]);
  if (!appsResult.ok) return appsResult;
  if (!snapshotResult.ok) return snapshotResult;

  const hasFlowReviews = hasTable(deps.sql, "flow_sdk_reviews");
  const workflows: WorkflowFlowSdkStatus[] = [];
  for (const wf of snapshotResult.value.workflows) {
    if (!wf.has_flow) continue;
    const flowSdk = wf.flow_sdk ?? DEFAULT_MISSING_FLOW_SDK;
    const level = flowSdkStatusOf(flowSdk, flowInfo);
    const review = hasFlowReviews
      ? loadLastFlowSdkReview(deps.sql, wf.project, wf.name)
      : null;
    const relevantNoteVersion =
      level === "current"
        ? undefined
        : flowNoteVersions
            .filter(
              (version) =>
                compareVersion(version, flowSdk) > 0 &&
                compareVersion(version, flowInfo.current) <= 0,
            )
            .at(-1);
    workflows.push({
      project: wf.project,
      project_name: wf.project_name,
      workflow: wf.name,
      flow_sdk: flowSdk,
      current: flowInfo.current,
      supported_from: flowInfo.supported_from,
      level,
      note:
        relevantNoteVersion === undefined
          ? null
          : `flow-${relevantNoteVersion}.md`,
      reviewed_through: review?.through ?? null,
      review_decision: review?.decision ?? null,
    });
  }

  const lastPlatform = hasTable(deps.sql, "platform_reviews")
    ? loadLastPlatformReview(deps.sql)
    : null;
  const through = lastPlatform?.through ?? null;
  const latest = allNotes.at(-1)?.id ?? null;
  const unreviewed = unreviewedPlatformNotes(allNotes, through);
  const open_follow_ups = hasTable(deps.sql, "follow_up_items")
    ? listFollowUps(deps.sql, { state: "open" })
    : [];

  return ok({
    apps: appsResult.value,
    workflows,
    platform: { through, latest, unreviewed },
    open_follow_ups,
    workspace_summary: snapshotResult.value.summary,
    all_notes: allNotes,
  });
}

function formatFollowUpItems(items: readonly PreparedItem[]): string[] {
  if (items.length === 0) return [];
  const lines = [
    "",
    'When you finish each follow-up item below, report its result with `lophn follow-up report <id> --state done|changed|skipped --outcome "<one line>"`:',
  ];
  for (const item of items) {
    lines.push(
      `- ${item.id}: ${item.title}`,
      `  ${item.proposal.replaceAll("\n", "\n  ")}`,
      ...(item.source_ref !== undefined ? [`  ref: ${item.source_ref}`] : []),
    );
  }
  return lines;
}

export function appSdkUpdateBody(
  status: AppSdkStatus,
  items: readonly PreparedItem[],
): string {
  const moves = status.sdks.filter((sdk) => sdk.level !== "current");
  const lines = [
    "SDK update for this app, handed over by lophn at Home via /update. Follow the migrate-sdk skill.",
    "",
  ];
  if (moves.length === 0) {
    lines.push("No SDK version change is needed.");
  } else {
    lines.push(
      "Move these SDK packages (pinned -> target) and read their notes:",
    );
    for (const sdk of moves) {
      lines.push(
        `- ${sdk.sdk}: ${sdk.pinned} -> ${sdk.current}${sdk.level === "required" ? " (required: the app does not start or soon will not)" : ""}`,
        `  notes: ${sdk.notes.join(", ")}`,
      );
    }
  }
  lines.push("", OWNERSHIP_SPLIT_NOTE, ...formatFollowUpItems(items));
  return lines.join("\n");
}

export function flowSdkUpdateBody(
  wf: WorkflowFlowSdkStatus,
  items: readonly PreparedItem[],
): string {
  const lines = [
    `Workflow @lophn/flow update for "${wf.workflow}" in project "${wf.project_name}", handed over by lophn at Home via /update. Follow the migrate-sdk skill.`,
    "",
    `- @lophn/flow: ${wf.flow_sdk} -> ${wf.current}${wf.level === "required" ? " (required: this workflow is blocked until migrated and verified)" : ""}`,
    ...(wf.note !== null ? [`  note: ${wf.note}`] : []),
    `Run \`lophn workflow check ${wf.workflow}\` after updating to stamp \`flow_sdk\` in workflow.yaml. Any paused/blocked runs can be resumed with [Resume with updated code].`,
    "",
    OWNERSHIP_SPLIT_NOTE,
    ...formatFollowUpItems(items),
  ];
  return lines.join("\n");
}

export function platformUpdateBody(
  through: string,
  workspace: FollowUpWorkspace | null,
  items: readonly PreparedItem[],
): string {
  const scopeNote =
    workspace === null
      ? "For global runtime: custom agents, update their definitions with agent.update if needed."
      : "For workspace-scoped runtime: custom agents in this workspace, update their definitions with agent.update if needed.";
  const lines = [
    `Platform update follow-up (through ${through}), handed over via /update.`,
    "",
    OWNERSHIP_SPLIT_NOTE,
    scopeNote,
    ...formatFollowUpItems(items),
  ];
  return lines.join("\n");
}

function hasOpenWorkspaceUpdateNotice(sql: Query): boolean {
  if (!hasTable(sql, "notices")) return false;
  return (
    sql.get(
      `SELECT 1 AS ok FROM notices
       WHERE source = 'program' AND coalesce(app, '') = ''
         AND (key = ? OR kind = 'workspace_update_needed')
         AND read_at IS NULL
       LIMIT 1`,
      [WORKSPACE_UPDATE_NOTICE_KEY],
    ) !== undefined
  );
}

export async function refreshWorkspaceUpdateNotice(
  deps: UpdateStatusDeps & {
    noticeRecorder: (
      input: NoticeRecordInput,
    ) => Promise<Result<{ id: string }>>;
  },
): Promise<Result<unknown> | null> {
  const status = await readUpdateStatus(deps);
  if (!status.ok) return status;
  return await recordWorkspaceUpdates(
    {
      apps: status.value.apps,
      workflows: status.value.workflows,
      unreviewedNotes: status.value.platform.unreviewed.length,
      hasOpenNotice: () => hasOpenWorkspaceUpdateNotice(deps.sql),
    },
    deps.noticeRecorder,
  );
}

export type UpdateDecideDeps = {
  openSql(): Result<{ sql: Query; close(): void }>;
  dataRoot: string;
  skillsRoot?: string;
  writer(): Writer;
  ids: IdSource;
  bodyPrepare?(): BodyPrepare | undefined;
  knownSecrets?(): KnownSecretMatch | undefined;
  noticeRecorder?():
    | ((input: NoticeRecordInput) => Promise<Result<{ id: string }>>)
    | undefined;
  onNoticeError?(message: string): void;
};

export function updateDecideHandler(deps: UpdateDecideDeps) {
  return async (
    ctx: AuthenticatedContext,
    raw: unknown,
  ): Promise<Result<unknown>> => {
    const parsed = workspaceUpdateDecide.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "invalid update decide input",
      });
    }
    const actor = parseActor(ctx.actor);
    if (
      actor === undefined ||
      (actor.kind !== "agent" && actor.kind !== "user")
    ) {
      return err({
        code: "forbidden",
        message: "only user or Home agent decides workspace updates",
      });
    }
    if (actor.kind === "agent" && ctx.conditions.turn === undefined) {
      return err({ code: "forbidden", message: "only an agent turn decides" });
    }

    const opened = deps.openSql();
    if (!opened.ok) {
      return err({ code: "unavailable", message: "ledger is unavailable" });
    }
    let statusData: UpdateStatusOutput & { all_notes: PlatformNoteSummary[] };
    try {
      if (
        !isUpdateActorAllowed(
          opened.value.sql,
          ctx.actor,
          ctx.conditions,
          false,
        )
      ) {
        return err({
          code: "forbidden",
          message: "only user or Home agent decides workspace updates",
        });
      }
      const loaded = await readUpdateStatus({
        sql: opened.value.sql,
        dataRoot: deps.dataRoot,
        skillsRoot: deps.skillsRoot,
      });
      if (!loaded.ok) return loaded;
      statusData = loaded.value;
    } finally {
      opened.value.close();
    }

    const appById = new Map(statusData.apps.map((app) => [app.app, app]));
    const wfByKey = new Map(
      statusData.workflows.map((wf) => [`${wf.project}:${wf.workflow}`, wf]),
    );
    const knownNotes = new Set(statusData.all_notes.map((n) => n.id));
    const redactor = createProductRedactor(deps.knownSecrets?.());

    const redactTextBody = (
      text: string,
    ): Result<{ type: "text"; text: string }[]> => {
      const safe = redactBlocks(redactor, [{ type: "text", text }]);
      if (safe === null) {
        return err({
          code: "unavailable",
          message: "update handoff redaction did not finish",
        });
      }
      return ok(safe as { type: "text"; text: string }[]);
    };

    const operations: PreparedOperation[] = [];
    const bodiesToPrepare: { type: "text"; text: string }[][] = [];

    for (const decision of parsed.data.decisions) {
      if (decision.kind === "app_sdk") {
        const status = appById.get(decision.app);
        if (status === undefined) {
          return err({ code: "not_found", message: "app not found" });
        }
        const items: PreparedItem[] = (decision.items ?? []).map((item) => ({
          ...item,
          id: deps.ids.newId("fup"),
        }));
        if (decision.decision === "leave") {
          if (items.length > 0) {
            return err({
              code: "invalid_input",
              message: "items belong to an update",
            });
          }
          if (status.sdks.some((sdk) => sdk.level === "required")) {
            return err({
              code: "invalid_input",
              message:
                "a required SDK update cannot be left: decide update for this app",
            });
          }
        } else if (
          items.length === 0 &&
          status.sdks.every((sdk) => sdk.level === "current")
        ) {
          return err({
            code: "invalid_input",
            message:
              "nothing to update: every SDK is current and no item is chosen",
          });
        }
        const through = Object.fromEntries(
          status.sdks.map((sdk) => [sdk.sdk, sdk.current]),
        );
        if (decision.decision === "update") {
          const body = redactTextBody(appSdkUpdateBody(status, items));
          if (!body.ok) return body;
          bodiesToPrepare.push(body.value);
          operations.push({
            kind: "app_sdk",
            app: decision.app,
            decision: "update",
            through,
            items,
            body: body.value,
          });
        } else {
          operations.push({
            kind: "app_sdk",
            app: decision.app,
            decision: "leave",
            through,
            items,
          });
        }
      } else if (decision.kind === "flow_sdk") {
        const wf = wfByKey.get(`${decision.project}:${decision.workflow}`);
        if (wf === undefined) {
          return err({ code: "not_found", message: "workflow not found" });
        }
        const items: PreparedItem[] = (decision.items ?? []).map((item) => ({
          ...item,
          id: deps.ids.newId("fup"),
        }));
        if (decision.decision === "leave") {
          if (items.length > 0) {
            return err({
              code: "invalid_input",
              message: "items belong to an update",
            });
          }
          if (wf.level === "required") {
            return err({
              code: "invalid_input",
              message:
                "a required flow SDK update cannot be left: decide update for this workflow",
            });
          }
        } else if (items.length === 0 && wf.level === "current") {
          return err({
            code: "invalid_input",
            message:
              "nothing to update: flow SDK is current and no item is chosen",
          });
        }
        if (decision.decision === "update") {
          const body = redactTextBody(flowSdkUpdateBody(wf, items));
          if (!body.ok) return body;
          bodiesToPrepare.push(body.value);
          operations.push({
            kind: "flow_sdk",
            project: decision.project,
            workflow: decision.workflow,
            decision: "update",
            through: wf.current,
            items,
            body: body.value,
          });
        } else {
          operations.push({
            kind: "flow_sdk",
            project: decision.project,
            workflow: decision.workflow,
            decision: "leave",
            through: wf.current,
            items,
          });
        }
      } else {
        if (knownNotes.size > 0 && !knownNotes.has(decision.through)) {
          return err({
            code: "invalid_input",
            message: `unknown platform note id: ${decision.through}`,
          });
        }
        const handoffs: Extract<
          PreparedOperation,
          { kind: "platform" }
        >["handoffs"] = [];
        for (const handoff of decision.handoffs ?? []) {
          const items: PreparedItem[] = handoff.items.map((item) => ({
            ...item,
            id: deps.ids.newId("fup"),
          }));
          const body = redactTextBody(
            platformUpdateBody(decision.through, handoff.workspace, items),
          );
          if (!body.ok) return body;
          if (handoff.workspace !== null || actor.kind === "user") {
            bodiesToPrepare.push(body.value);
          }
          handoffs.push({
            workspace: handoff.workspace,
            items,
            body: body.value,
          });
        }
        operations.push({
          kind: "platform",
          through: decision.through,
          handoffs,
        });
      }
    }

    const relay = deps.bodyPrepare?.();
    if (bodiesToPrepare.length > 0 && relay !== undefined) {
      const prepared = await prepareBodies(
        relay,
        UPDATE_RECORD_CONTEXT,
        bodiesToPrepare,
      );
      if (!prepared.ok) return prepared;
    }

    const done = await deps.writer().command(UPDATE_RECORD_CONTEXT, {
      command: workspaceUpdateRecord.name,
      input: {
        session: actor.kind === "agent" ? (actor.id as Id<"ses">) : null,
        turn:
          actor.kind === "agent" ? (ctx.conditions.turn as Id<"trn">) : null,
        operations,
      },
      idempotency_key: deps.ids.newId("sdr"),
      compare: {},
      prepared: [],
    });
    if (!done.ok) return done;

    // 결정 commit 직후 `workspace_update_needed` 알림을 최신 건수로 갱신(모두 0이면 자동 해소)한다.
    const noticeRecorder = deps.noticeRecorder?.();
    if (noticeRecorder !== undefined) {
      const reopened = deps.openSql();
      if (reopened.ok) {
        try {
          const refreshed = await refreshWorkspaceUpdateNotice({
            sql: reopened.value.sql,
            dataRoot: deps.dataRoot,
            skillsRoot: deps.skillsRoot,
            noticeRecorder,
          });
          if (refreshed !== null && !refreshed.ok) {
            deps.onNoticeError?.(refreshed.error.message);
          }
        } catch (thrown) {
          deps.onNoticeError?.(String(thrown));
        } finally {
          reopened.value.close();
        }
      }
    }

    return ok(done.value.result);
  };
}

export function withUpdateDecide(
  writer: Writer,
  handler: ReturnType<typeof updateDecideHandler>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      if (envelope.command !== workspaceUpdateDecide.name) {
        return await writer.command(ctx, envelope);
      }
      const handled = await handler(ctx, envelope.input);
      if (!handled.ok) return handled;
      return ok({
        result: handled.value,
        replayed: false,
        first_seq: null,
        last_seq: null,
      });
    },
  };
}

export const updatesWiring: WiringFactory = () => ({
  name: "updates",
  operations: () => [
    { name: workspaceUpdateRecord.name, actors: ["machine"], kind: "command" },
  ],
  records: () => [UPDATE_RECORD_CONTEXT],
  build(ctx) {
    const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
    const statusRouteKey = `${workspaceUpdateStatus.resource}/${workspaceUpdateStatus.method}`;

    const decide = updateDecideHandler({
      openSql: () => openConnection(ctx.ledgerPath),
      dataRoot: ctx.root.path,
      writer: () => ctx.writer,
      ids,
      bodyPrepare: () => ctx.peek.bodyPrepare,
      knownSecrets: () => ctx.peek.knownSecrets,
      noticeRecorder: () => ctx.peek.noticeRecorder,
      onNoticeError: (message) =>
        ctx.telemetry.logger.error({
          component: "updates",
          event: "workspace_update_notice_refresh_failed",
          fields: { message },
        }),
    });

    // 제품 판·SDK 판·플랫폼 메모가 바뀐 기동마다 통합 `workspace_update_needed` 알림을 갱신한다.
    ctx.productStartListeners.push(async (start) => {
      if (!start.changed && !start.sdksChanged) return;
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) {
        throw new Error(opened.error.message);
      }
      try {
        const refreshed = await refreshWorkspaceUpdateNotice({
          sql: opened.value.sql,
          dataRoot: ctx.root.path,
          noticeRecorder: ctx.noticeRecorder,
        });
        if (refreshed !== null && !refreshed.ok) {
          throw new Error(refreshed.error.message);
        }
      } finally {
        opened.value.close();
      }
    });

    return ok({
      writer: (inner) => withUpdateDecide(inner, decide),
      memory: [
        [
          statusRouteKey,
          async (auth, raw) => {
            const parsed = workspaceUpdateStatus.input.safeParse(raw ?? {});
            if (!parsed.success) {
              return err({
                code: "invalid_input",
                message: "invalid update status input",
              });
            }
            const opened = openConnection(ctx.ledgerPath);
            if (!opened.ok) {
              return err({
                code: "unavailable",
                message: "ledger is unavailable",
              });
            }
            try {
              if (
                !isUpdateActorAllowed(
                  opened.value.sql,
                  auth.actor,
                  auth.conditions,
                  true,
                )
              ) {
                return err({
                  code: "forbidden",
                  message: "only user or Home agent reads workspace updates",
                });
              }
              const loaded = await readUpdateStatus({
                sql: opened.value.sql,
                dataRoot: ctx.root.path,
              });
              if (!loaded.ok) return loaded;
              const { all_notes: _allNotes, ...output } = loaded.value;
              return ok(output);
            } finally {
              opened.value.close();
            }
          },
        ],
      ],
    });
  },
});
