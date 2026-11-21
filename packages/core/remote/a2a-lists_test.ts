import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { manualClock, ok } from "../../base/mod.ts";
import type { AgentCard } from "../../protocol/lophn-agent/agent-definitions.ts";
import { DEFAULT_CALL_POLICY } from "../../protocol/lophn-agent/call-policy.ts";
import type {
  AuthenticatedContext,
  SchemaStep,
  Sql,
} from "../../protocol/server/mod.ts";
import { TEAMS, WIRINGS } from "../main/daemon/assembly.ts";
import { a2aListsReads } from "../main/daemon/wiring/a2a-lists.ts";
import { assemble } from "../main/daemon/registration.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import { createA2aLists } from "./a2a-lists.ts";

// 다른 컴퓨터가 이 기계의 열린 session과 agent 명함을 읽는다. private인 workspace의 것이 새거나, 폰과 명단 밖 기기가 읽으면 곤란하다.

const ORIGIN = "mch_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const SELF = "mch_0bbbbbbbbbbbbbbbbbbbbbbbbb";
const OPEN = "prj_00000000000000000000000001";
const HIDDEN = "prj_00000000000000000000000002";
const OPEN_ID = "pri_00000000000000000000000001";
const HIDDEN_ID = "pri_00000000000000000000000002";

let root = "";
let sql: Sql;
let db: DatabaseSync;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "a2a-lists-"));
  const path = join(root, "base.db");
  const wirings = WIRINGS.map((make) => make());
  const assembled = assemble(TEAMS, {});
  assert.ok(assembled.ok);
  const steps: SchemaStep[] = [
    ...wirings.flatMap((wiring) => wiring.schemaSteps ?? []),
    ...assembled.value.schemaSteps,
    ...wirings.flatMap((wiring) => wiring.schemaStepsAfterTeams ?? []),
  ];
  const migrated = await applyMigrations(path, steps, {
    clock: manualClock(Date.UTC(2026, 0, 1)),
  });
  assert.ok(migrated.ok, JSON.stringify(migrated));
  db = new DatabaseSync(path);
  sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  db.exec(`insert into projects (id, name, title, purpose, revision, status, identity) values
    ('${OPEN}', 'shop', 'shop', '', '1', 'active', '${OPEN_ID}'),
    ('${HIDDEN}', 'diary', 'diary', '', '1', 'active', '${HIDDEN_ID}')`);
  // 다른 컴퓨터(ORIGIN)의 mail이 연 session 셋(home, project, private project)과 이 기계의 사람이 연 session 하나.
  db.exec(`insert into sessions (id, agent, project, workspace_kind, workspace_id, opened_by_machine, created_seq, state_seq) values
    ('ses_home', 'lophn_home', null, null, null, '${ORIGIN}', 1, 1),
    ('ses_open', 'lophn_${OPEN}', '${OPEN}', 'project', '${OPEN}', '${ORIGIN}', 2, 2),
    ('ses_hidden', 'lophn_${HIDDEN}', '${HIDDEN}', 'project', '${HIDDEN}', '${ORIGIN}', 3, 3),
    ('ses_person', 'lophn_${OPEN}', '${OPEN}', 'project', '${OPEN}', null, 4, 4)`);
});
after(async () => {
  db.close();
  await rm(root, { recursive: true });
});

const CARD: AgentCard = {
  handle: "reviewer",
  name: "Reviewer",
  workspace: null,
  runtime: "lophn",
  modality: { input: ["text"], output: ["text"] },
  replies: ["result"],
  diff: { plus: [], minus: [] },
  notes: [],
  callable: { home: true, here: true },
};

function lists() {
  const asked: unknown[] = [];
  const handlers = createA2aLists({
    policy: () => ({
      ...DEFAULT_CALL_POLICY,
      private: [{ kind: "project", id: HIDDEN }],
    }),
    computers: () => [
      { machine: ORIGIN, device: "dev_pc", name: "pc", self: false },
      { machine: SELF, device: "dev_self", name: "me", self: true },
    ],
    resolve: () => {
      throw new Error("the receiving side resolves no computer");
    },
    call: () => {
      throw new Error("the receiving side calls no computer");
    },
    ...a2aListsReads(sql),
    cards: (workspace) => {
      asked.push(workspace);
      return Promise.resolve(ok([CARD]));
    },
    sender: () => {
      throw new Error("the receiving side has no sender");
    },
    remoteWorkspace: () => {
      throw new Error("the receiving side has no sender");
    },
  });
  return { handlers, asked };
}

function device(id: string): AuthenticatedContext {
  return {
    principal: `device:${id}`,
    actor: "user",
    scope: { operations: [], targets: {} },
    conditions: { process: "remote" },
    credential_ref: `cred_${id}`,
  } as AuthenticatedContext;
}

test("다른 컴퓨터가 읽는 session 목록과 agent 명함에 이 기계에서 private인 workspace의 것이 없고, 폰과 명단 밖 기기는 읽지 못한다", async () => {
  const { handlers, asked } = lists();
  const pc = device("dev_pc");

  // 그 컴퓨터의 mail이 연 session만 오고, private project의 session은 빠진다.
  const sessions = handlers.sessions(pc);
  assert.ok(sessions.ok, JSON.stringify(sessions));
  assert.deepStrictEqual(
    sessions.value.sessions.map((one) => [one.session, one.workspace]),
    [
      ["ses_home", { kind: "home" }],
      ["ses_open", { kind: "project", identity: OPEN_ID, name: "shop" }],
    ],
  );

  // private project와 없는 project는 같은 답이고 명함을 읽지도 않는다.
  for (const project of [HIDDEN_ID, "pri_00000000000000000000000009"]) {
    const read = await handlers.agents(pc, {
      workspace: { project: project as never },
    });
    assert.deepStrictEqual(read, ok({ found: false, cards: [] }));
  }
  assert.deepStrictEqual(asked, []);
  const open = await handlers.agents(pc, {
    workspace: { project: OPEN_ID },
  });
  const { callable: _callable, ...card } = CARD;
  assert.deepStrictEqual(open, ok({ found: true, cards: [card] }));
  assert.deepStrictEqual(asked, [{ kind: "project", id: OPEN }]);

  // 폰, 명단 밖 기기, 기기가 아닌 자격은 읽지 못한다.
  for (const who of [
    device("dev_phone"),
    device("dev_gone"),
    { ...pc, principal: "user:person" },
  ]) {
    const read = handlers.sessions(who);
    assert.equal(read.ok ? "ok" : read.error.code, "forbidden");
    const agents = await handlers.agents(who, { workspace: { home: true } });
    assert.equal(agents.ok ? "ok" : agents.error.code, "forbidden");
  }
  assert.deepStrictEqual(asked, [{ kind: "project", id: OPEN }]);
});
