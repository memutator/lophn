// 할당(agent가 쓸 앱과 뺀 command)의 저장. 정의 파일의 `apps`(앱 slug)와 `permissions.deny`가 정본이다.
// approvals는 정의 파일도 앱 표도 모르므로 읽고 쓰는 길을 이 조립이 port로 꽂는다.
// writer·reader Worker가 팀 등록 file로 import하고, core는 data step을 낸다.
import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import type { AssignmentEntry } from "../../../../protocol/approvals/mod.ts";
import type { AgentId } from "../../../../protocol/lophn-agent/places.ts";
import type { SchemaStep, Sql } from "../../../../protocol/server/mod.ts";
import {
  type AssignmentPorts,
  assignmentGetRead,
  assignmentPorts,
  assignmentSetCommand,
  type AssignmentState,
} from "../../../approvals/assignment/mod.ts";
import { loadApp } from "../../../apps/registration/store.ts";
import { loadActiveDeclaration } from "../../../apps/releases/store.ts";
import { agentAssignment, denyRuleOf } from "../../../apps/usage/users.ts";
import type { AgentInfo } from "../../../lophn-agent/agents/directory.ts";
import type { AgentFileSystem } from "../../../lophn-agent/agents/ports.ts";
import {
  createAgentStore,
  dataRootOf,
  writeAgentAssignment,
} from "../../../lophn-agent/agents/store.ts";
import {
  defineTxPort,
  openConnection,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import { assignmentSchema } from "../../../../protocol/approvals/mod.ts";
import type { WiringFactory } from "./context.ts";
import { agentDirectory } from "./lophn-agent-team.ts";

// 동기 file API는 core 프로세스의 module graph에 정적으로 두지 않는다. adapter는 URL로 연다.
const NODE_AGENT_FILES = new URL(
  "../../../lophn-agent/agents/adapters/node-fs.ts",
  import.meta.url,
).href;
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

// 할당 내용(앱과 deny 규칙)에서 정한 비교 값. 48 bit라 정수로 안전하다.
function revisionOf(info: AgentInfo | null): number {
  if (info === null || (info.apps.length === 0 && info.deny.length === 0)) {
    return 0;
  }
  const hash = createHash("sha256")
    .update(canonicalize({ apps: info.apps, deny: info.deny }))
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

// 할당의 앱 id와 뺀 command를 파일에 쓸 slug와 deny 규칙으로 바꾼다. 없는 앱과 active 선언에 없는 command는 버린다.
function fileValuesOf(
  sql: Query,
  entries: readonly AssignmentEntry[],
): Result<{ apps: string[]; deny: string[] }> {
  const apps: string[] = [];
  const deny: string[] = [];
  for (const entry of entries) {
    const app = loadApp(sql, entry.app);
    if (!app.ok) return app;
    if (app.value === null) continue;
    apps.push(app.value.slug);
    if (entry.removed_tools.length === 0) continue;
    const active = loadActiveDeclaration(sql, entry.app);
    if (!active.ok) return active;
    for (const command of active.value?.declaration.commands ?? []) {
      if (entry.removed_tools.includes(command.name)) {
        deny.push(denyRuleOf(command));
      }
    }
  }
  return ok({ apps, deny });
}

// 이 할당이 다루는 규칙은 옛 앱과 새 앱의 command 규칙이다. 그 밖의 deny 규칙은 그대로 둔다.
function managedRules(
  sql: Query,
  apps: readonly string[],
): Result<Set<string>> {
  const rules = new Set<string>();
  for (const app of apps) {
    const active = loadActiveDeclaration(sql, app);
    if (!active.ok) return active;
    for (const command of active.value?.declaration.commands ?? []) {
      rules.add(denyRuleOf(command));
    }
  }
  return ok(rules);
}

export function writeAssignment(
  sql: Query,
  agent: AgentId,
  entries: readonly AssignmentEntry[],
  revision: number,
): Result<AssignmentState> {
  const agents = agentDirectory(sql);
  const info = agents.agent(agent);
  if (info === null) {
    return err({ code: "not_found", message: "agent not found" });
  }
  if (revisionOf(info) !== revision) {
    return err({
      code: "conflict",
      message: "agent assignment revision changed",
    });
  }
  const before = agentAssignment(sql, agent, agents);
  if (!before.ok) return before;
  const next = fileValuesOf(sql, entries);
  if (!next.ok) return next;
  const managed = managedRules(sql, [
    ...before.value.entries.map((entry) => entry.app),
    ...entries.map((entry) => entry.app),
  ]);
  if (!managed.ok) return managed;
  const root = dataRootOf(sql, undefined);
  if (!root.ok) return root;
  const written = writeAgentAssignment(
    createAgentStore(createNodeAgentFiles(), root.value),
    agent,
    {
      apps: next.value.apps,
      deny: [
        ...info.deny.filter((rule) => !managed.value.has(rule)),
        ...next.value.deny,
      ],
    },
  );
  if (!written.ok) return written;
  return readAssignment(sql, agent);
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

// 옛 표의 줄마다 그 agent 파일에 apps와 permissions.deny를 쓰고 표를 지운다.
// 파일이 없거나 틀린 agent의 줄은 버린다(쓸 곳이 없다). 앱이 없는 줄과 active 선언에 없는 command도 버린다.
// 다시 돌아도 같은 결과다(파일은 줄 값으로 덮는다).
export const assignmentFileStep: DataStep = {
  id: "approvals.assignment-file",
  async run(root) {
    const opened = openConnection(`${root}/lophn.db`);
    if (!opened.ok) return opened;
    const connection = opened.value;
    try {
      const table = connection.sql.get(
        "select 1 as found from sqlite_master where type = 'table' and name = 'agent_assignments'",
        [],
      );
      if (table === undefined) return ok(undefined);
      const store = createAgentStore(createNodeAgentFiles(), root);
      for (const row of connection.sql.all(
        "select agent, entries from agent_assignments",
        [],
      )) {
        let parsed;
        try {
          parsed = assignmentSchema.safeParse({
            agent: row["agent"],
            entries: JSON.parse(String(row["entries"])),
          });
        } catch {
          continue;
        }
        if (!parsed.success) continue;
        const values = fileValuesOf(connection.sql, parsed.data.entries);
        if (!values.ok) return values;
        if (values.value.apps.length === 0) continue;
        const written = writeAgentAssignment(
          store,
          parsed.data.agent,
          values.value,
        );
        if (!written.ok && written.error.code === "unavailable") return written;
      }
      connection.exec("drop table agent_assignments");
      return ok(undefined);
    } finally {
      connection.close();
    }
  },
};

export const assignmentFileWiring: WiringFactory = () => ({
  name: "assignment-file",
  dataSteps: [assignmentFileStep],
});
