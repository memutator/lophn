// jobs의 team 등록 file. writer·reader Worker가 import한다.
// jobs는 session 표와 agent·project·앱 이름 풀기를 모르므로 이 조립이 jobTargetsPort로 꽂는다.
// reader port는 등록마다 모아 모든 read가 같이 쓰므로(같은 key를 두 곳에 두면 기동 때 던진다)
// read를 가진 jobs/register.ts와 따로 둔다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/mod.ts";
import {
  DEFAULT_CALL_POLICY,
  isPrivate,
  mayReachWorkspace,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  agentHandleKey,
  CODING_BUILTINS,
  DEFAULT_PERMISSION_MODE,
  HARNESS_RUNTIMES,
  isHarnessRuntime,
  type PermissionMode,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import {
  WORKFLOW_DECLARATION_FILE,
  WORKFLOW_FLOW_FILE,
  workflowFolder,
} from "../../../../protocol/workflows/mod.ts";
import {
  defaultModeSetting,
  workflowModesSetting,
} from "../../../approvals/mod.ts";
import { appStatusOf } from "../../../apps/lookups.ts";
import { loadActiveDeclaration } from "../../../apps/releases/store.ts";
import { createFileSettingsReader } from "../../../config/mod.ts";
import { callPolicyAt } from "../../../config/setting-declarations.ts";
import type {
  JobEventPolicy,
  JobTargetAvailability,
  JobTargets,
  JobWorkflowModes,
} from "../../../jobs/ports.ts";
import {
  jobEventPolicyPort,
  jobMachinePort,
  jobTargetAvailabilityPort,
  jobTargetsPort,
  jobWorkflowModesPort,
  jobZonePort,
} from "../../../jobs/ports.ts";
import { dataRootOf } from "../../../lophn-agent/agents/store.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import {
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import { readMachineIdSync } from "../../../machine/mod.ts";
import { projectStatusOf } from "../../../projects/lookups.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";
import {
  parseDeclaration,
  participantsOf,
} from "../../../workflows/declaration.ts";

type Query = Pick<Sql, "get" | "all">;

function targetsOf(sql: Query): JobTargets {
  return {
    creatorOf(session) {
      const row = loadSession({ sql }, session);
      return row === undefined
        ? undefined
        : { agent: row.agent, workspace: workspaceOf(row) };
    },
    // wiring/runs.ts의 agents.resolve와 같은 호출이다.
    resolveAgent(address) {
      return createSessionDirectory({
        ...workspaceDepsOf(sql),
        publish: () => {},
        sql: () => sql,
      }).resolveAddress(address);
    },
    resolveApp(ref) {
      const found = workspaceDepsOf(sql).apps.appByName(ref);
      return found.ok ? ok(found.value.id) : found;
    },
    resolveProject(ref) {
      const found = workspaceDepsOf(sql).projects.projectByName(ref);
      return found === null
        ? err({ code: "not_found", message: "project not found" })
        : ok(found.id);
    },
  };
}

// event 때의 판정. writer Worker 안에서 설정 파일(call 정책)을 읽는다(Router와 같다).
function eventPolicyOf(sql: Query): JobEventPolicy {
  return {
    resolveSource(ref) {
      const found = workspaceDepsOf(sql).apps.appByName(ref);
      return found.ok
        ? ok({ app: found.value.id, slug: found.value.name })
        : found;
    },
    declares(app, event) {
      // 보관한 앱은 event를 내지 못한다.
      if (appStatusOf(sql, app) !== "active") return false;
      const active = loadActiveDeclaration(sql, app);
      return (
        active.ok &&
        active.value !== null &&
        (active.value.declaration.events ?? []).some(
          (declared) => declared.name === event,
        )
      );
    },
    drivenSession(session) {
      // 터미널 탭의 coding agent는 사람이 연 것이다.
      if (session.startsWith("term:")) return false;
      const row = sql.get(
        "SELECT spawned_by, called_from_kind FROM sessions WHERE id = ?",
        [session],
      );
      if (row === undefined) return true;
      if (row["spawned_by"] !== null || row["called_from_kind"] !== null) {
        return true;
      }
      // run 입력(unattended 사람 메시지)이나 workflow step 입력을 받은 session은 사람이 연 것이 아니다.
      return (
        sql.get(
          `SELECT 1 AS found FROM messages
            WHERE session = ? AND ((from_kind = 'human' AND unattended = 1) OR step_instance IS NOT NULL)
            LIMIT 1`,
          [session],
        ) !== undefined
      );
    },
    reaches(from, to) {
      const root = dataRootOf(sql, undefined);
      const policy = root.ok ? callPolicyAt(root.value) : DEFAULT_CALL_POLICY;
      return mayReachWorkspace(policy, from as never, to as never);
    },
    isPrivate(workspace) {
      const root = dataRootOf(sql, undefined);
      const policy = root.ok ? callPolicyAt(root.value) : DEFAULT_CALL_POLICY;
      return isPrivate(policy, workspace as never);
    },
  };
}

// 이 기계의 id는 Worker마다 처음 한 번 읽어 둔다(복사·이름 바꾸기는 기동 때 맞춰지고 도는 동안 바뀌지 않는다). 읽지 못하면 다음에 다시 읽는다.
function machineReader(): (sql: Query) => { id(): Result<Id<"mch">> } {
  let known: Id<"mch"> | undefined;
  return (sql) => ({
    id() {
      if (known !== undefined) return ok(known);
      const root = dataRootOf(sql, undefined);
      if (!root.ok) return root;
      const read = readMachineIdSync(root.value);
      if (read.ok) known = read.value;
      return read;
    },
  });
}

function targetAvailabilityOf(sql: Query): JobTargetAvailability {
  return {
    appActive: (id) => appStatusOf(sql, id) === "active",
    projectActive: (id) => projectStatusOf(sql, id) === "active",
  };
}

function isBuiltinHarness(agent: string): boolean {
  const key = agentHandleKey(agent);
  if ((HARNESS_RUNTIMES as readonly string[]).includes(key)) return true;
  return CODING_BUILTINS.some(
    (b) => agentHandleKey(b.harness) === key || agentHandleKey(b.id) === key,
  );
}

function workflowModesOf(sql: Query): JobWorkflowModes {
  return {
    workflowModesOf(project, workflow) {
      const root = dataRootOf(sql, undefined);
      if (!root.ok) return {};
      const reader = createFileSettingsReader(root.value);
      const remembered =
        reader.get(workflowModesSetting)?.[`${project}/${workflow}`];
      const globalDefault =
        reader.get(defaultModeSetting) ?? DEFAULT_PERMISSION_MODE;
      const folder = workflowFolder(root.value, project, workflow);
      let declaration: string | null = null;
      try {
        declaration = readFileSync(
          join(folder, WORKFLOW_DECLARATION_FILE),
          "utf8",
        );
      } catch {
        declaration = null;
      }
      if (declaration === null) {
        return remembered !== undefined ? { ...remembered } : {};
      }
      const parsed = parseDeclaration({
        name: workflow,
        declaration,
        flow: existsSync(join(folder, WORKFLOW_FLOW_FILE)),
        artifacts: { static: false, instance: false },
      });
      if (!parsed.ok) {
        return remembered !== undefined ? { ...remembered } : {};
      }
      const participants = participantsOf(parsed.declaration);
      const deps = workspaceDepsOf(sql);
      const resolved: Record<string, PermissionMode> = {};
      for (const [key, participant] of Object.entries(participants)) {
        if ("kind" in participant) continue;
        if (isBuiltinHarness(participant.agent)) continue;
        const addr = deps.names.resolveAddress({
          agent: participant.agent,
          workspace: { project },
        });
        const info = addr.ok ? deps.agents.agent(addr.value.agent) : null;
        if (info !== null && isHarnessRuntime(info.runtime)) continue;
        resolved[key] =
          remembered?.[key] ?? info?.permissionMode ?? globalDefault;
      }
      return resolved;
    },
  };
}

export function createCoreRegistration() {
  const machineOf = machineReader();
  return {
    ports: [
      defineTxPort(jobMachinePort, (tx) => machineOf(tx.sql)),
      defineTxPort(jobTargetsPort, (tx) => targetsOf(tx.sql)),
      defineTxPort(jobTargetAvailabilityPort, (tx) =>
        targetAvailabilityOf(tx.sql),
      ),
      defineTxPort(jobWorkflowModesPort, (tx) => workflowModesOf(tx.sql)),
      defineTxPort(jobEventPolicyPort, (tx) => eventPolicyOf(tx.sql)),
      defineTxPort(jobZonePort, () => ({
        zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      })),
    ],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  const machineOf = machineReader();
  return {
    reads: [],
    ports: new Map<unknown, unknown>([
      [jobMachinePort, snapshotPort((snapshot) => machineOf(snapshot.sql))],
      [jobTargetsPort, snapshotPort((snapshot) => targetsOf(snapshot.sql))],
      [
        jobTargetAvailabilityPort,
        snapshotPort((snapshot) => targetAvailabilityOf(snapshot.sql)),
      ],
      [
        jobWorkflowModesPort,
        snapshotPort((snapshot) => workflowModesOf(snapshot.sql)),
      ],
      [
        jobEventPolicyPort,
        snapshotPort((snapshot) => eventPolicyOf(snapshot.sql)),
      ],
    ]),
  };
}
