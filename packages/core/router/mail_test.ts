import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { manualClock, ok } from "../../base/mod.ts";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
} from "../../protocol/lophn-agent/call-policy.ts";
import type { RemoteAddress } from "../../protocol/lophn-agent/calls.ts";
import { textBlocks } from "../../protocol/lophn-agent/content-block.ts";
import type { Mail } from "../../protocol/lophn-agent/mail.ts";
import {
  isLophn,
  workspaceOfLophn,
} from "../../protocol/lophn-agent/workspaces.ts";
import type { SchemaStep, Sql, Tx } from "../../protocol/server/mod.ts";
import { createWorkspaceNameRules } from "../agent-workspaces/workspace/session-directory.ts";
import type { AgentDirectory } from "../lophn-agent/agents/directory.ts";
import { createSessionDirectory } from "../lophn-agent/workspaces/directory.ts";
import { TEAMS, WIRINGS } from "../main/daemon/assembly.ts";
import { assemble } from "../main/daemon/registration.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import {
  createMailOutbox,
  createMailSeen,
  pendingMails,
} from "./mail-store.ts";
import type { RoutedInput } from "./ports.ts";
import { createRouter } from "./router.ts";
import { createCallStore } from "./store.ts";

// 실제 ledger schema, store, session directory로 두 기계의 Router 사이에 mail을 오가게 한다. 같은 mail이 두 번 돌거나, 켤 때 정산이
// 다른 기계로 보낸 call을 잃은 것으로 닫거나, private workspace와 사람이 연 session에 다른 컴퓨터가 끼어들면 곤란하다.

const A = "mch_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "mch_0bbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "mch_0ccccccccccccccccccccccccc";
const PROJECT = "prj_00000000000000000000000001";
const IDENTITY = "pri_00000000000000000000000001";
const REVIEWER = "agt_00000000000000000000000001";

function allSteps(): SchemaStep[] {
  const wirings = WIRINGS.map((make) => make());
  const assembled = assemble(TEAMS, {});
  assert.ok(assembled.ok);
  return [
    ...wirings.flatMap((wiring) => wiring.schemaSteps ?? []),
    ...assembled.value.schemaSteps,
    ...wirings.flatMap((wiring) => wiring.schemaStepsAfterTeams ?? []),
  ];
}

let root = "";
let ledger = "";
before(async () => {
  root = await mkdtemp(join(tmpdir(), "mail-"));
  ledger = join(root, "base.db");
  const migrated = await applyMigrations(ledger, allSteps(), {
    clock: manualClock(Date.UTC(2026, 0, 1)),
  });
  assert.ok(migrated.ok, JSON.stringify(migrated));
});
after(async () => {
  await rm(root, { recursive: true });
});

const agents: AgentDirectory = {
  agent: (id) =>
    id === REVIEWER
      ? {
          id,
          handle: "reviewer",
          name: "Reviewer",
          workspace: null,
          skip: false,
          runtime: "lophn",
          apps: [],
          deny: [],
          remoteApps: [],
        }
      : isLophn(id)
        ? {
            id,
            handle: "lophn",
            name: "lophn",
            workspace: workspaceOfLophn(id),
            skip: false,
            runtime: "lophn",
            apps: [],
            deny: [],
            remoteApps: [],
          }
        : null,
  agents: () => [agents.agent(REVIEWER)!],
  cardOf: () => null,
};

let machines = 0;

// 한 기계: 빈 ledger 하나, 실제 store·directory·outbox와 받은 입력을 적는 transport.
async function machine(self: string, policy: CallPolicy = DEFAULT_CALL_POLICY) {
  const index = ++machines;
  const path = join(root, `${index}.db`);
  await copyFile(ledger, path);
  const db = new DatabaseSync(path);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  let counter = 0;
  const tx = {
    sql,
    now: () => "2026-11-21T00:00:00.000Z",
    // mail은 id 모양을 schema로 검사한다.
    newId: (prefix: string) =>
      `${prefix}_0${String(index * 1_000_000 + ++counter).padStart(25, "0")}`,
  } as unknown as Tx;
  const projects = {
    project: (id: string) =>
      id === PROJECT ? ({ id, archived: false } as never) : null,
    projectByName: (name: string) =>
      name === PROJECT ? ({ id: PROJECT, archived: false } as never) : null,
  };
  const apps = {
    app: () => null,
    appByName: () =>
      ({ ok: false, error: { code: "not_found", message: "no app" } }) as never,
  };
  const delivered: { session: string; input: RoutedInput }[] = [];
  const router = createRouter({
    directory: {
      ...createSessionDirectory({
        projects,
        apps,
        agents,
        names: createWorkspaceNameRules({ projects, apps, agents }),
        publish: () => {},
        sql: () => sql,
      }),
      projectOfIdentity: (identity) => (identity === IDENTITY ? PROJECT : null),
      identityOfProject: () => ok(IDENTITY),
    },
    transport: {
      deliver: (_tx, target, input) => {
        delivered.push({ session: target.session, input });
        return ok(undefined);
      },
      cancel: () => ok(undefined),
    },
    store: createCallStore(),
    outbox: createMailOutbox(),
    seen: createMailSeen(),
    self: () => self,
    callPolicy: () => policy,
    announce: () => {},
  });
  const count = (table: string) =>
    Number(db.prepare(`select count(*) as n from ${table}`).get()?.["n"]);
  const call = (id: string) =>
    db
      .prepare(
        "select state, fail_reason, delivery, receiver_session from agent_calls where call = ?",
      )
      .get(id);
  // 사람이나 이 기계의 agent가 여는 session.
  const openSession = (agent: string) => {
    const opened = createSessionDirectory({
      projects,
      apps,
      agents,
      names: createWorkspaceNameRules({ projects, apps, agents }),
      publish: () => {},
      sql: () => sql,
    }).open(tx, { agent, workspace: null }, { kind: "human" }, null);
    assert.ok(opened.ok);
    return opened.value.session;
  };
  return { self, db, sql, tx, router, delivered, count, call, openSession };
}

type Machine = Awaited<ReturnType<typeof machine>>;

function send(
  from: Machine,
  session: string,
  peer: string,
  address: RemoteAddress,
  dedup: string,
) {
  const sent = from.router.sendRemote(from.tx, {
    session,
    dedup,
    self: from.self,
    peer: { machine: peer, computer: "peer" },
    address,
    reply: "result",
    body: textBlocks("review the branch"),
    unattended: false,
  });
  assert.ok(sent.ok, JSON.stringify(sent));
  return sent.value.call;
}

// from의 outbox에서 to로 가는 mail을 모두 to에 적용하고 from에 ack를 적는다.
function carry(from: Machine, to: Machine, computer = "from") {
  const mails = pendingMails(from.sql, to.self as never);
  for (const mail of mails) {
    const applied = to.router.applyMail(to.tx, {
      mail,
      origin: { machine: from.self, computer },
      skipAllowed: false,
      via: "link",
    });
    assert.ok(applied.ok, JSON.stringify(applied));
    const acked = from.router.mailSent(from.tx, {
      mail: mail.id,
      result: { kind: "acked", applied: applied.value },
    });
    assert.ok(acked.ok);
  }
  return mails;
}

test("같은 mail id를 두 번 적용해도 session 하나, 받은 입력 하나, call 행 하나다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  send(a, sender, B, { agent: "reviewer", workspace: { home: true } }, "t1");
  const [mail] = pendingMails(a.sql, B as never);
  assert.ok(mail !== undefined);
  const apply = (one: Mail) =>
    b.router.applyMail(b.tx, {
      mail: one,
      origin: { machine: A, computer: "laptop" },
      skipAllowed: false,
      via: "link",
    });
  const first = apply(mail);
  const second = apply(mail);
  assert.ok(first.ok && second.ok);
  assert.equal(first.value.delivery, "running");
  assert.deepStrictEqual(second.value, first.value);
  assert.equal(b.count("sessions"), 1);
  assert.equal(b.delivered.length, 1);
  assert.equal(b.count("agent_calls"), 1);
  // 받은 session은 그 기계의 mail이 연 것으로 남는다.
  assert.equal(
    b.db.prepare("select opened_by_machine from sessions").get()?.[
      "opened_by_machine"
    ],
    A,
  );
});

test("켤 때 정산은 다른 컴퓨터로 보낸 call을 닫지 않고, 다른 컴퓨터에서 받아 가져가지 않은 call은 lophn_restarted로 닫아 보낸 기계로 실패 mail을 낸다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  const call = send(
    a,
    sender,
    B,
    { agent: "reviewer", workspace: { home: true } },
    "t1",
  );
  carry(a, b);
  assert.equal(a.call(call)?.["delivery"], "running");

  const kept = a.router.failLostOnStart(a.tx, true);
  assert.ok(kept.ok);
  assert.equal(kept.value, 0);
  assert.equal(a.call(call)?.["state"], "accepted");

  const closed = b.router.failLostOnStart(b.tx, true);
  assert.ok(closed.ok);
  assert.equal(closed.value, 1);
  assert.deepStrictEqual(
    { ...b.call(call) },
    {
      state: "failed",
      fail_reason: "lophn_restarted",
      delivery: null,
      receiver_session: b.delivered[0]!.session,
    },
  );
  const [failure] = carry(b, a);
  assert.equal(failure?.kind, "reply");
  assert.deepStrictEqual(failure?.kind === "reply" && failure.outcome, {
    state: "failed",
    reason: "lophn_restarted",
  });
  // 보낸 기계의 행도 닫히고 보낸 session이 늦은 실패를 받는다.
  assert.equal(a.call(call)?.["fail_reason"], "lophn_restarted");
  assert.equal(a.delivered.at(-1)?.session, sender);
  assert.equal(a.delivered.at(-1)?.input.outcome?.reason, "lophn_restarted");
});

test("받는 기계에서 private인 workspace로 온 call mail은 session을 열지 않고 not_found 실패 mail로 돌아간다", async () => {
  const a = await machine(A);
  const b = await machine(B, {
    ...DEFAULT_CALL_POLICY,
    private: [{ kind: "project", id: PROJECT }],
  });
  const sender = a.openSession("lophn_home");
  const call = send(
    a,
    sender,
    B,
    { agent: "reviewer", workspace: { project: IDENTITY } },
    "t1",
  );
  carry(a, b);
  assert.equal(b.count("sessions"), 0);
  assert.equal(b.delivered.length, 0);
  // ack가 실패를 실어 보낸 기계의 행을 닫는다. 받는 기계의 실패 mail도 같은 결과로 닫힌 행에 닿는다.
  assert.equal(a.call(call)?.["fail_reason"], "not_found");
  const [failure] = carry(b, a);
  assert.deepStrictEqual(failure?.kind === "reply" && failure.outcome, {
    state: "failed",
    reason: "not_found",
  });
  assert.equal(a.call(call)?.["fail_reason"], "not_found");
});

test("다른 컴퓨터의 call mail은 사람이 연 session을 주소로 써도 그 session에 입력을 넣지 못하고(not_found), 그 기계의 mail이 연 session에는 이어서 들어간다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const c = await machine(C);
  const person = b.openSession(REVIEWER);
  const sender = a.openSession("lophn_home");

  const intrude = send(a, sender, B, { session: person }, "t1");
  carry(a, b);
  assert.equal(b.delivered.length, 0);
  assert.equal(a.call(intrude)?.["fail_reason"], "not_found");

  send(a, sender, B, { agent: "reviewer", workspace: { home: true } }, "t2");
  carry(a, b);
  const opened = b.delivered[0]!.session;
  assert.notEqual(opened, person);
  assert.equal(b.count("sessions"), 2);

  const follow = send(a, sender, B, { session: opened }, "t3");
  carry(a, b);
  assert.equal(b.delivered.length, 2);
  assert.equal(b.delivered[1]!.session, opened);
  assert.equal(a.call(follow)?.["delivery"], "running");

  // 셋째 기계의 mail도 A의 mail이 연 session에 끼어들지 못한다.
  const other = c.openSession("lophn_home");
  const third = send(c, other, B, { session: opened }, "t4");
  carry(c, b);
  assert.equal(b.delivered.length, 2);
  assert.equal(c.call(third)?.["fail_reason"], "not_found");
});

// 사람의 ledger에는 agent_calls와 messages에 지난 call과 대화가 있다. 다시 짠 표에 옛 행이 칸마다 그대로 옮겨지고, 새 칸은 null이며,
// index·trigger와 messages의 FK 자식(checkpoints)이 그대로여야 한다.
test("다시 짠 agent_calls와 messages에 옛 행이 칸 그대로 옮겨진다", async () => {
  const steps = allSteps();
  const mine = steps.findIndex(
    (step) => step.id === "router.remote-sender.agent-calls",
  );
  assert.ok(mine > 0);
  const path = join(root, "old.db");
  const clock = manualClock(Date.UTC(2026, 0, 1));
  assert.ok((await applyMigrations(path, steps.slice(0, mine), { clock })).ok);

  const db = new DatabaseSync(path);
  db.exec(`insert into sessions (id, agent, created_seq, state_seq) values
    ('ses_a', 'lophn_home', 1, 1), ('ses_b', 'lophn_home', 2, 2)`);
  db.exec(`insert into messages (id, session, from_kind, from_ref, call, reply_to, refs, reply, event,
      fail_reason, delivery, unattended, step_instance, step_name, turn, body, created_seq, created_at, state_seq, shell, origin_app)
    values
    ('msg_1', 'ses_a', 'human', null, null, null, '[]', null, null, null, 'steer', 1, null, null, 'trn_1', '${"a".repeat(64)}', 1, 't1', 1, 0, 'app_x|notes'),
    ('msg_2', 'ses_b', 'agent', 'ses_a', 'cal_1', null, '[{"kind":"file","path":"a.md"}]', 'result', null, null, 'next_turn', 0, null, null, null, '${"b".repeat(64)}', 2, 't2', 3, 0, null),
    ('msg_3', 'ses_a', 'program', null, 'cal_1', 'cal_1', '[]', null, null, 'receiver_ended', 'next_turn', 0, null, null, null, '${"c".repeat(64)}', 3, 't3', 3, 0, null),
    ('msg_4', 'ses_b', 'app', 'app_x|notes', 'cal_2', null, '[]', 'none', null, null, 'next_turn', 0, null, null, null, '${"d".repeat(64)}', 4, 't4', 4, 0, null)`);
  db.exec(
    `insert into checkpoints (message, session) values ('msg_2', 'ses_b')`,
  );
  db.exec(`insert into agent_calls (call, from_session, "to", receiver_session, reply, state, fail_reason, dedup,
      consumed, unattended, created_at, state_at, ask, from_app, result)
    values
    ('cal_1', 'ses_a', '{"kind":"open_session","session":"ses_b"}', 'ses_b', 'result', 'failed', 'receiver_ended', 'tool_1', 1, 1, 'c1', 's1', 'question', null, null),
    ('cal_2', null, '{"kind":"open_session","session":"ses_b"}', 'ses_b', 'result', 'done', null, 'key', 1, 0, 'c2', 's2', null, 'app_x|notes', 'the answer'),
    ('cal_3', 'ses_b', '{"kind":"open_session","session":"ses_a"}', null, 'none', 'accepted', null, null, 0, 0, 'c3', 's3', null, null, null)`);
  const objects = (conn: DatabaseSync, name: string) =>
    conn
      .prepare(
        "select type, name, sql from sqlite_master where tbl_name = ? and type in ('index', 'trigger') and name not like 'sqlite_%' order by type, name",
      )
      .all(name)
      .map((row) => ({ ...row }));
  const shape = {
    messages: objects(db, "messages"),
    agent_calls: objects(db, "agent_calls"),
  };
  const rowsOf = (conn: DatabaseSync, table: string, key: string) =>
    conn
      .prepare(`select * from ${table} order by ${key}`)
      .all()
      .map((row) => ({ ...row }));
  const messages = rowsOf(db, "messages", "id");
  const calls = rowsOf(db, "agent_calls", "call");
  db.close();

  const migrated = await applyMigrations(path, steps, { clock });
  assert.ok(migrated.ok, JSON.stringify(migrated));
  const next = new DatabaseSync(path);
  next.exec("pragma foreign_keys=ON");
  assert.deepStrictEqual(rowsOf(next, "messages", "id"), messages);
  assert.deepStrictEqual(
    rowsOf(next, "agent_calls", "call"),
    calls.map((row) => ({
      ...row,
      from_machine: null,
      delivery: null,
      remote_session: null,
    })),
  );
  assert.deepStrictEqual(objects(next, "messages"), shape.messages);
  assert.deepStrictEqual(objects(next, "agent_calls"), shape.agent_calls);
  assert.equal(
    next.prepare("select count(*) as n from checkpoints").get()?.["n"],
    1,
  );
  assert.deepStrictEqual(next.prepare("pragma foreign_key_check").all(), []);
  assert.throws(() => next.exec("delete from messages where id = 'msg_2'"));
  // 끝난 call은 그대로 바뀌지 않는다.
  assert.throws(() =>
    next.exec(
      "update agent_calls set delivery = 'running' where call = 'cal_1'",
    ),
  );
  next.close();
});
