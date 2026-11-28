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
const GONE = "prj_00000000000000000000000003";
const GONE_ID = "pri_00000000000000000000000003";
const APP_OK = "app_00000000000000000000000001";
const APP_OLD = "app_00000000000000000000000002";
const APP_SECRET = "app_00000000000000000000000003";

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
    ('${HIDDEN}', 'diary', 'diary', '', '1', 'active', '${HIDDEN_ID}'),
    ('${GONE}', 'old', 'old', '', '1', 'archived', '${GONE_ID}')`);
  db.exec(`insert into apps (id, slug, name, description, run_enabled, revision, status) values
    ('${APP_OK}', 'notes', 'Notes', 'n', 1, '1', 'active'),
    ('${APP_OLD}', 'retired', 'Retired', 'r', 0, '1', 'archived'),
    ('${APP_SECRET}', 'secret', 'Secret', 's', 1, '1', 'active')`);
  // 다른 컴퓨터(ORIGIN)의 mail이 연 session 넷(home, project, private project, 보관한 project)과 이 기계의 사람이 연 session 하나.
  db.exec(`insert into sessions (id, agent, project, workspace_kind, workspace_id, opened_by_machine, created_seq, state_seq) values
    ('ses_home', 'lophn_home', null, null, null, '${ORIGIN}', 1, 1),
    ('ses_open', 'lophn_${OPEN}', '${OPEN}', 'project', '${OPEN}', '${ORIGIN}', 2, 2),
    ('ses_hidden', 'lophn_${HIDDEN}', '${HIDDEN}', 'project', '${HIDDEN}', '${ORIGIN}', 3, 3),
    ('ses_person', 'lophn_${OPEN}', '${OPEN}', 'project', '${OPEN}', null, 4, 4),
    ('ses_gone', 'lophn_${GONE}', '${GONE}', 'project', '${GONE}', '${ORIGIN}', 5, 5)`);
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
      private: [
        { kind: "project", id: HIDDEN },
        { kind: "app", id: APP_SECRET },
      ],
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
    cards: (workspace, withoutApps) => {
      asked.push([workspace, withoutApps]);
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
  // 명함은 이 기계에서 private인 앱을 빼고 만든다.
  assert.deepStrictEqual(asked, [
    [{ kind: "project", id: OPEN }, ["app_00000000000000000000000003"]],
  ]);

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
  assert.equal(asked.length, 1);
});

test("다른 컴퓨터는 보관한 project와 앱의 명함과 session을 읽지 못하고 private 앱도 없는 앱과 같다", async () => {
  const { handlers, asked } = lists();
  const pc = device("dev_pc");
  // 보관한 project의 session은 입력을 받지 않아 목록에 없다.
  const sessions = handlers.sessions(pc);
  assert.ok(sessions.ok);
  assert.ok(!sessions.value.sessions.some((one) => one.session === "ses_gone"));
  for (const workspace of [
    { project: GONE_ID },
    { app: APP_OLD },
    { app: APP_SECRET },
  ] as const) {
    const read = await handlers.agents(pc, { workspace } as never);
    assert.deepStrictEqual(
      read,
      ok({ found: false, cards: [] }),
      JSON.stringify(workspace),
    );
  }
  assert.deepStrictEqual(asked, []);
  const app = await handlers.agents(pc, { workspace: { app: APP_OK } });
  assert.ok(app.ok && app.value.found);
});

// 보내는 쪽: 다른 컴퓨터의 답은 이 컴퓨터 밖의 글이다. 길이·제어 문자·개수를 줄이지 않거나, 틀린 답이나 그 컴퓨터의 오류 글이
// 그대로 agent에게 가거나, session 없는 자격이나 닿으면 안 되는 session이 그 컴퓨터를 부르면 곤란하다.
const LAPTOP = {
  machine: "mch_0ccccccccccccccccccccccccc",
  device: "dev_laptop",
  name: "laptop",
  self: false,
} as const;
const MESSY = `a\u0007b\u001b[31m\nc${"x".repeat(3000)}`;
const AT = "2026-11-21T00:00:00.000Z";

function sender(answer: () => unknown) {
  const sent: unknown[] = [];
  const handlers = createA2aLists({
    policy: () => DEFAULT_CALL_POLICY,
    computers: () => [LAPTOP],
    resolve: () => ok(LAPTOP),
    call: (_device, call, by) => {
      sent.push({ call, by });
      return Promise.resolve(answer() as never);
    },
    openSessions: () => [],
    project: () => null,
    projectByIdentity: () => null,
    app: () => null,
    cards: () => Promise.resolve(ok([])),
    // remoteReach 자리: ses_private만 닿으면 안 되는 session이다.
    sender: (session) =>
      session === "ses_private"
        ? { ok: false, error: { code: "forbidden", message: "private" } }
        : ok({ workspace: null, agent: "lophn_home", name: "Lophn" }),
    remoteWorkspace: () => ok({ home: true }),
  });
  return { handlers, sent };
}

function agentOf(session: string | undefined): AuthenticatedContext {
  return {
    principal: "agent",
    actor: `agent:${session ?? "x"}`,
    scope: { operations: [], targets: {} },
    conditions: session === undefined ? {} : { session },
    credential_ref: "cred_agent",
  } as AuthenticatedContext;
}

const clean = (value: string, max: number) =>
  value.length <= max && !/[^\P{Cc}\n\t]/u.test(value);

test("다른 컴퓨터의 목록과 명함은 모든 글 칸을 줄이고, 틀린 답과 그 컴퓨터의 오류는 정해진 꼴이며, session 검사가 부르기 앞에 선다", async () => {
  const me = agentOf("ses_me");
  const row = (at: number) => ({
    session: `ses_${String(at).padStart(26, "0")}`,
    handle: MESSY,
    name: MESSY,
    title: MESSY,
    workspace: {
      kind: "project",
      identity: `pri_0${"1".repeat(25)}`,
      name: MESSY,
    },
    state: "idle",
    last_active_at: at === 0 ? "yesterday\u0007" : AT,
  });
  const listed = sender(() =>
    ok({ sessions: Array.from({ length: 250 }, (_, at) => row(at)) }),
  );
  const sessions = await listed.handlers.machineSessions(me, {
    machine: "laptop",
  });
  assert.ok(sessions.ok, JSON.stringify(sessions));
  assert.equal(sessions.value.sessions.length, 200);
  const [first, second] = sessions.value.sessions;
  assert.ok(first !== undefined && second !== undefined);
  assert.equal(first.last_active_at, null);
  assert.equal(second.last_active_at, AT);
  assert.ok(clean(first.handle, 64) && clean(first.name, 64));
  assert.ok(first.title !== null && clean(first.title, 256));
  assert.ok(!first.title.includes("\n"));
  assert.ok(
    first.workspace.kind === "project" && clean(first.workspace.name, 64),
  );
  assert.deepStrictEqual(listed.sent, [
    {
      call: {
        resource: "a2a",
        method: "sessions",
        body: {},
        deadlineMs: 5000,
      },
      by: {
        kind: "agent",
        agent: "lophn_home",
        session: "ses_me",
        name: "Lophn",
      },
    },
  ]);

  const card = {
    handle: `rev${MESSY}`,
    name: MESSY,
    workspace: null,
    description: MESSY,
    runtime: "lophn",
    model: { provider: MESSY, model_name: MESSY, price: null },
    modality: { input: ["text"], output: ["text"] },
    replies: ["result"],
    diff: {
      plus: Array.from({ length: 80 }, () => MESSY),
      minus: Array.from({ length: 80 }, () => MESSY),
    },
    notes: Array.from({ length: 40 }, () => MESSY),
    callable: { home: true, here: true },
  };
  const carded = sender(() =>
    ok({ found: true, cards: Array.from({ length: 250 }, () => card) }),
  );
  const agents = await carded.handlers.machineAgents(me, { machine: "laptop" });
  assert.ok(agents.ok, JSON.stringify(agents));
  assert.equal(agents.value.cards.length, 200);
  const one = agents.value.cards[0];
  assert.ok(one !== undefined);
  assert.equal(one.callable, undefined);
  assert.ok(clean(one.handle, 64) && clean(one.name, 64));
  assert.ok(one.description !== undefined && clean(one.description, 1024));
  assert.ok(one.model !== undefined);
  assert.ok(clean(one.model.provider, 256) && clean(one.model.model_name, 256));
  assert.equal(one.diff.plus.length, 50);
  assert.equal(one.diff.minus.length, 50);
  assert.equal(one.notes.length, 20);
  for (const each of [...one.diff.plus, ...one.diff.minus, ...one.notes]) {
    assert.ok(clean(each, 1024));
  }

  // 틀린 답은 unavailable이다.
  const malformed = sender(() => ok({ sessions: [{ session: 1 }] }));
  const bad = await malformed.handlers.machineSessions(me, {
    machine: "laptop",
  });
  assert.equal(bad.ok ? "ok" : bad.error.code, "unavailable");

  // 그 컴퓨터의 오류는 정해진 꼴로 다시 쓰고 details를 싣지 않는다.
  const refused = sender(() => ({
    ok: false,
    error: { code: "forbidden", message: MESSY, details: { secret: "x" } },
  }));
  const no = await refused.handlers.machineSessions(me, { machine: "laptop" });
  assert.ok(!no.ok);
  assert.equal(no.error.code, "forbidden");
  assert.ok(no.error.message.startsWith("laptop refused: "));
  assert.ok(clean(no.error.message, "laptop refused: ".length + 256));
  assert.equal(no.error.details, undefined);

  // session 없는 자격과 닿으면 안 되는 session은 그 컴퓨터를 부르지 않는다.
  for (const who of [agentOf(undefined), agentOf("ses_private")]) {
    const guarded = sender(() => {
      throw new Error("must not call");
    });
    const read = await guarded.handlers.machineSessions(who, {
      machine: "laptop",
    });
    assert.equal(read.ok ? "ok" : read.error.code, "forbidden");
    assert.deepStrictEqual(guarded.sent, []);
  }
});
