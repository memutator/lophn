// 다른 컴퓨터 앱 할당의 저장. 정의 파일의 `remote_apps`가 정본이다. 이 컴퓨터의 앱은 할당이 아니라 skill 배포가 닿게 한다(`skill-deploy.ts`).
// approvals는 정의 파일을 모르므로 읽고 쓰는 길을 이 조립이 port로 꽂는다. writer·reader Worker가 팀 등록 file로 import하고, core는 data step을 낸다.
import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import type { AssignmentEntry } from "../../../../protocol/approvals/mod.ts";
import type { AgentId } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { SchemaStep, Sql } from "../../../../protocol/server/mod.ts";
import {
  type AssignmentPorts,
  type LocalAppLine,
  assignmentGetRead,
  assignmentPorts,
  assignmentSetCommand,
  type AssignmentState,
} from "../../../approvals/assignment/mod.ts";
import { publicSkillsOf } from "../../../apps/lookups.ts";
import { loadApp } from "../../../apps/registration/store.ts";
import { agentAssignment } from "../../../apps/usage/users.ts";
import type {
  AgentInfo,
  RemoteAppLine,
} from "../../../lophn-agent/agents/directory.ts";
import type { AgentFileSystem } from "../../../lophn-agent/agents/ports.ts";
import {
  createAgentStore,
  dataRootOf,
  writeAgentDeployedSkills,
  writeAgentRemoteApps,
} from "../../../lophn-agent/agents/store.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import { platformEntryUrl } from "../../../install-and-update/mod.ts";
import type { WiringFactory } from "./context.ts";
import { agentDirectory } from "./lophn-agent-team.ts";

// 동기 file API는 core 프로세스의 module graph에 정적으로 두지 않는다. adapter는 URL로 연다.
const NODE_AGENT_FILES = platformEntryUrl(import.meta.url, "agentNodeFs").href;
const { createNodeAgentFiles } = (await import(NODE_AGENT_FILES)) as {
  createNodeAgentFiles(): AgentFileSystem;
};

type Query = Pick<Sql, "get" | "all">;

// 옛 표를 만든 step이다. 이미 적용한 ledger가 이 id를 기록하고 있어 목록에서 뺄 수 없다(빼면 기동을 거절한다).
// 새 data root에는 data step이 돌지 않아 빈 표가 남는다. 쓰는 곳은 없다.
const OLD_TABLE_STEPS: SchemaStep[] = [
  {
    id: "agent_assignments",
    sql: `
create table agent_assignments (
  agent text primary key,
  entries text not null,
  revision integer not null check (revision > 0),
  updated_at text not null
);`,
  },
];

// 다른 컴퓨터 앱 할당에서 정한 비교 값. 48 bit라 정수로 안전하다. 없으면 0이다.
function revisionOf(info: AgentInfo | null): number {
  if (info === null || info.remoteApps.length === 0) return 0;
  const hash = createHash("sha256")
    .update(canonicalize({ remote_apps: info.remoteApps }))
    .digest("hex");
  return Number.parseInt(hash.slice(0, 12), 16);
}

export function readAssignment(
  sql: Query,
  agent: AgentId,
): Result<AssignmentState> {
  const agents = agentDirectory(sql);
  const assignment = agentAssignment(sql, agent, agents);
  if (!assignment.ok) return assignment;
  return ok({
    assignment: assignment.value,
    revision: revisionOf(agents.agent(agent)),
  });
}

function remoteLinesOf(entries: readonly AssignmentEntry[]): RemoteAppLine[] {
  return entries.map((entry) => ({
    machine: entry.machine,
    app: entry.app,
    name: entry.name,
    removed: entry.removed_tools,
    ...(entry.ask_tools && entry.ask_tools.length > 0
      ? { ask: entry.ask_tools }
      : {}),
  }));
}

// 이 컴퓨터 앱의 줄(`machine`이 없는 줄)은 그 앱의 public skill 전부를 agent 층에 배포하는 것이다(공유 요청의 승인). 다른 컴퓨터 앱의 줄만 `remote_apps`로 쓴다.
export function writeAssignment(
  sql: Query,
  agent: AgentId,
  entries: readonly (AssignmentEntry | LocalAppLine)[],
  revision: number,
): Result<AssignmentState> {
  const info = agentDirectory(sql).agent(agent);
  if (info === null) {
    return err({ code: "not_found", message: "agent not found" });
  }
  if (revisionOf(info) !== revision) {
    return err({
      code: "conflict",
      message: "agent assignment revision changed",
    });
  }
  const root = dataRootOf(sql, undefined);
  if (!root.ok) return root;
  const store = createAgentStore(createNodeAgentFiles(), root.value);
  const remote = entries.filter(
    (entry): entry is AssignmentEntry => "machine" in entry,
  );
  if (remote.length > 0 || info.remoteApps.length > 0) {
    const written = writeAgentRemoteApps(store, agent, remoteLinesOf(remote));
    if (!written.ok) return written;
  }
  for (const entry of entries) {
    if ("machine" in entry) continue;
    const deployed = deployApp(sql, agent, entry.app);
    if (!deployed.ok) return deployed;
  }
  return readAssignment(sql, agent);
}

function deployApp(sql: Query, agent: AgentId, app: string): Result<void> {
  const info = agentDirectory(sql).agent(agent);
  if (info === null) {
    return err({ code: "not_found", message: "agent not found" });
  }
  const loaded = loadApp(sql, app);
  if (!loaded.ok) return loaded;
  if (loaded.value === null) {
    return err({ code: "not_found", message: "app not found" });
  }
  const slug = loaded.value.slug;
  const added = publicSkillsOf(sql, app)
    .filter(
      (skill) =>
        !info.deployedSkills.some(
          (one) => one.app === slug && one.skill === skill,
        ),
    )
    .map((skill) => ({ app: slug, skill }));
  if (added.length === 0) return ok(undefined);
  const root = dataRootOf(sql, undefined);
  if (!root.ok) return root;
  const written = writeAgentDeployedSkills(
    createAgentStore(createNodeAgentFiles(), root.value),
    agent,
    [...info.deployedSkills, ...added],
  );
  return written.ok ? ok(undefined) : written;
}

function portsOf(sql: Query): AssignmentPorts {
  return {
    get: (agent) => readAssignment(sql, agent),
    set: (agent, entries, revision) =>
      writeAssignment(sql, agent, entries, revision),
  };
}

export function createCoreRegistration() {
  return {
    schemaSteps: OLD_TABLE_STEPS,
    commands: [assignmentSetCommand],
    reads: [assignmentGetRead],
    ports: [defineTxPort(assignmentPorts, (tx) => portsOf(tx.sql))],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [assignmentGetRead],
    ports: new Map<unknown, unknown>([
      [assignmentPorts, snapshotPort((snapshot) => portsOf(snapshot.sql))],
    ]),
  };
}

// 옛 판의 data step 둘(`agent_assignments` 표를 정의 파일의 `apps`로 옮기기, deny 규칙을 앱 slug로 바꾸기)이다. 이미 적용한 data root가
// id를 기록하고 있어 목록에서 뺄 수 없다. 할당(`apps`·`permissions`)은 `agents.drop-apps-permissions`가 지우므로 하는 일이 없다.
const retired = (id: string): DataStep => ({
  id,
  run: () => Promise.resolve(ok(undefined)),
});

export const assignmentFileWiring: WiringFactory = () => ({
  name: "assignment-file",
  dataSteps: [
    retired("approvals.assignment-file"),
    retired("approvals.deny-rule-slug"),
  ],
});
