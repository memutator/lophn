import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import {
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { DEFAULT_CALL_POLICY } from "../../protocol/lophn-agent/call-policy.ts";
import { callCancel } from "../../protocol/lophn-agent/calls.ts";
import { textBlocks } from "../../protocol/lophn-agent/content-block.ts";
import {
  MAIL_EXPIRY_MS,
  MAIL_LATE_MS,
  type MailApplied,
  mailDecideHold,
  type MailHold,
  mailHolds,
} from "../../protocol/lophn-agent/mail.ts";
import {
  isLophn,
  workspaceOfLophn,
} from "../../protocol/lophn-agent/workspaces.ts";
import type { Requester } from "../../protocol/machine/requester.ts";
import {
  REMOTE_ALLOWED_ROUTES,
  REMOTE_PERSON_ROUTES,
} from "../../protocol/remote/mod.ts";
import type {
  AuthenticatedContext,
  SchemaStep,
  Sql,
  Tx,
} from "../../protocol/server/mod.ts";
import { createWorkspaceNameRules } from "../agent-workspaces/workspace/session-directory.ts";
import type { AgentDirectory } from "../lophn-agent/agents/directory.ts";
import { createLophnInputTransport } from "../lophn-agent/run-loop/mod.ts";
import type { BodyPrepare } from "../lophn-agent/session/message-body.ts";
import {
  createReceivedRecorder,
  createSessionDirectory,
} from "../lophn-agent/workspaces/mod.ts";
import { TEAMS, WIRINGS } from "../main/daemon/assembly.ts";
import { assemble } from "../main/daemon/registration.ts";
import {
  createCallBodyPreparer,
  prepareBodies,
} from "../main/daemon/wiring/router.ts";
import {
  createDeviceCredentials,
  createRemoteCall,
  devicePrincipal,
  requesterOf,
} from "../remote/call.ts";
import { createMailDrain } from "../remote/mail-drain.ts";
import {
  createMailInbox,
  decideHoldHandler,
  holdsHandler,
  type MailEntryDeps,
} from "../remote/mail-entry.ts";
import { CredentialRegistry } from "../server/identity/mod.ts";
import {
  dispatchHttp,
  type MemoryHandler,
  RouteRegistry,
} from "../server/mod.ts";
import { STATE_CHANGED_TOPIC } from "../storage/ledger/after-commit.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import { createAdmission } from "../supervision/responsiveness/mod.ts";
import {
  callsMailSend,
  callsMailSent,
  callsMailSweep,
  createCallStore,
  createMailOutbox,
  createMailSeen,
  FAILURE_TEXTS,
  installRouterEnvironment,
  pendingMails,
  type RouterDeps,
  ROUTER_COMMANDS,
} from "./mod.ts";

// 늦게 온 mail과 만료다. 두 기계마다 실제 ledger schema, Router 명령, store, session directory, 받은 입력 기록을 두고 대기 목록의 두 route
// handler에서 writer 명령과 Router까지 한 번 잇는다. 늦게 온 call이 사람 없이 돌거나, 사람이 아닌 것(agent, 보낸 컴퓨터, 허락 없는 기기)이
// 대신 정하거나, 만료된 call이 돌거나 보낸 쪽에 끝없이 열려 있으면 곤란하다.

const A = "mch_0aaaaaaaaaaaaaaaaaaaaaaaaa" as Id<"mch">;
const B = "mch_0bbbbbbbbbbbbbbbbbbbbbbbbb" as Id<"mch">;
const A_DEV = "dev_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const B_DEV = "dev_0bbbbbbbbbbbbbbbbbbbbbbbbb";
const PHONE = "dev_0ppppppppppppppppppppppppp";
const REVIEWER = "agt_00000000000000000000000001";
// 정의가 skip인 agent.
const SKIPPER = "agt_00000000000000000000000002";
const MAIL_PRINCIPAL = "machine:mail";
const TEXT = "build and test this on the windows machine";

const ROSTER = [
  { machine: A, device: A_DEV, name: "laptop" },
  { machine: B, device: B_DEV, name: "windows" },
];

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
  root = await mkdtemp(join(tmpdir(), "mail-hold-"));
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
    id === REVIEWER || id === SKIPPER
      ? {
          id,
          handle: id === REVIEWER ? "reviewer" : "skipper",
          name: "Reviewer",
          workspace: null,
          skip: id === SKIPPER,
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
  agents: () => [agents.agent(REVIEWER)!, agents.agent(SKIPPER)!],
  cardOf: () => null,
};
const projects = { project: () => null, projectByName: () => null };
const apps = {
  app: () => null,
  appByName: () =>
    ({ ok: false, error: { code: "not_found", message: "no app" } }) as never,
};
const directoryOf = (sql: Sql) =>
  createSessionDirectory({
    projects,
    apps,
    agents,
    names: createWorkspaceNameRules({ projects, apps, agents }),
    publish: () => {},
    sql: () => sql,
  });

const routerDepsBySql = new Map<Sql, RouterDeps>();
installRouterEnvironment({
  deps: (view) => routerDepsBySql.get(view.sql as Sql)!,
  unattendedTurn: () => false,
});

const MAIL_CONTEXT = {
  principal: MAIL_PRINCIPAL,
  actor: "machine",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: MAIL_PRINCIPAL,
} as AuthenticatedContext;
const PERSON = {
  principal: "user:local",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
} as AuthenticatedContext;

const preparedKey = (k: { hash: string; principal: string; purpose: string }) =>
  `${k.principal} ${k.purpose} ${k.hash}`;

// 두 기계가 같이 보는 시각. test가 앞으로 돌린다.
const START = Date.parse("2026-11-21T00:00:00.000Z");
const clock = { ms: START };
const nowAt = () => new Date(clock.ms).toISOString();

let machines = 0;

async function machine(self: Id<"mch">) {
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
  const prepared = new Set<string>();
  // commit 뒤 할 일로 낸 바뀐 이름.
  const changes: unknown[] = [];
  const tx = {
    sql,
    now: nowAt,
    newId: (prefix: string) =>
      `${prefix}_0${String(index * 1_000_000 + ++counter).padStart(25, "0")}`,
    port: () => ({ push: () => {}, principal: () => MAIL_PRINCIPAL }),
    registerBlobRef: (ref: {
      source: { blob: { hash: string; principal: string; purpose: string } };
    }) =>
      prepared.has(preparedKey(ref.source.blob))
        ? ok({})
        : err({ code: "invalid_input", message: "body was not prepared" }),
  } as unknown as Tx;
  routerDepsBySql.set(sql, {
    directory: {
      ...directoryOf(sql),
      projectOfIdentity: () => null,
      identityOfProject: () => ok(null),
    },
    transport: createLophnInputTransport({
      record: createReceivedRecorder({ principal: () => MAIL_PRINCIPAL })
        .record,
    }),
    store: createCallStore(),
    outbox: createMailOutbox(),
    seen: createMailSeen(),
    self: () => self,
    callPolicy: () => DEFAULT_CALL_POLICY,
    announce: (_tx: Tx, topic: string, data: unknown) => {
      if (topic === STATE_CHANGED_TOPIC) changes.push(data);
    },
  } as unknown as RouterDeps);

  const relay: BodyPrepare = {
    live: (k) => prepared.has(preparedKey(k)),
    async prepare(call) {
      const bytes = Buffer.from(await new Response(call.bytes).arrayBuffer());
      const hash = createHash("sha256").update(bytes).digest("hex");
      prepared.add(preparedKey({ ...call, hash }));
      return ok({
        preparation: hash,
        principal: call.principal,
        purpose: call.purpose,
        hash,
        size_bytes: bytes.length,
      });
    },
  };
  const preparer = createCallBodyPreparer({ relay: () => relay });
  // 접은 writer 대신: 본문 준비 → schema → Router 명령을 한 tx로, 오류면 되돌린다.
  const command = async (
    route: { name: string },
    input: unknown,
    ctx: AuthenticatedContext = MAIL_CONTEXT,
  ): Promise<Result<unknown>> => {
    const ready = await preparer(ctx, {
      command: route.name,
      input,
      idempotency_key: "k",
      compare: {},
      prepared: [],
    });
    if (!ready.ok) return ready;
    const definition = ROUTER_COMMANDS.find(
      (each) => each.route.name === route.name,
    )!;
    const parsed = definition.route.input.safeParse(ready.value.input);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "input schema" });
    }
    db.exec("begin");
    try {
      const done = definition.handle(
        tx,
        ctx as never,
        parsed.data as never,
        {} as never,
      );
      db.exec(done.ok ? "commit" : "rollback");
      return done;
    } catch (thrown) {
      db.exec("rollback");
      throw thrown;
    }
  };

  // 이 컴퓨터에서 터미널 입력을 허락받은 기계.
  const grants = new Set<string>();
  const entry: MailEntryDeps = {
    command,
    sql,
    policy: () => DEFAULT_CALL_POLICY,
    computers: () =>
      ROSTER.map((each) => ({ ...each, self: each.machine === self })),
    resolve: () => err({ code: "not_found", message: "unused" }),
    self: () => self,
    redact: (blocks) => [...blocks],
    kind: () => "computer",
    granted: (machine) => grants.has(machine),
    requesterOf,
    prepare: (bodies) => prepareBodies(relay, MAIL_CONTEXT, bodies),
    now: nowAt,
  };
  // drain의 주기 timer(link 없이 sweep만 본다). 만료 알림의 글을 먼저 준비하는 것은 mail wiring과 같다.
  let timer: (() => Promise<void>) | undefined;
  createMailDrain({
    peers: () => [],
    pending: () => [],
    connected: () => null,
    call: async () => err({ code: "unavailable", message: "no link" }),
    record: async () => ok({}),
    async sweep() {
      const ready = await entry.prepare([textBlocks(FAILURE_TEXTS.expired)]);
      if (!ready.ok) return ready;
      return await command(callsMailSweep, {});
    },
    every(_ms, fn) {
      timer = fn;
      return () => {};
    },
    warn: () => {},
  }).start();

  const holds = async () => {
    const listed = await holdsHandler(entry)(PERSON, {});
    assert.ok(listed.ok);
    return (listed.value as { holds: MailHold[] }).holds;
  };
  // 이 컴퓨터의 사람이 화면에서 정한다.
  const decide = async (
    origin: string,
    mail: string,
    decision: "run_now" | "skip",
  ) => await decideHoldHandler(entry)(PERSON, { origin, mail, decision });

  const count = (table: string, where = "1") =>
    Number(
      db.prepare(`select count(*) as n from ${table} where ${where}`).get()?.[
        "n"
      ],
    );
  const callRow = (id: string) =>
    db
      .prepare(
        "select state, fail_reason, delivery, remote_session from agent_calls where call = ?",
      )
      .get(id);
  const openSession = (agent: string) => {
    const opened = directoryOf(sql).open(
      tx,
      { agent, workspace: null },
      { kind: "human" },
      null,
    );
    assert.ok(opened.ok);
    return opened.value.session;
  };
  // 이 기계의 session이 to 기계의 agent에게 call을 보낸다.
  const send = async (session: string, to: Id<"mch">, agent = "reviewer") => {
    const sent = await command(callsMailSend, {
      session,
      turn: null,
      dedup: `d${++counter}`,
      self,
      peer: { machine: to, computer: "windows" },
      address: { agent, workspace: { home: true } },
      reply: "result",
      body: textBlocks(TEXT),
    });
    assert.ok(sent.ok, JSON.stringify(sent));
    return (sent.value as { call: string }).call;
  };
  return {
    // 준비한 blob은 오래 살지 않는다. 대기 목록에서 며칠 기다린 뒤라 받을 때 준비한 본문이 남아 있지 않다.
    forget: () => prepared.clear(),
    self,
    db,
    sql,
    grants,
    entry,
    changes,
    command,
    holds,
    decide,
    count,
    callRow,
    openSession,
    send,
    tick: () => timer!(),
    inbox: createMailInbox(entry),
  };
}

type Machine = Awaited<ReturnType<typeof machine>>;

// from이 to로 낼 mail을 link로 닿은 것처럼 받는 입구에 넣고 받은 결과를 적는다.
async function carry(from: Machine, to: Machine): Promise<MailApplied[]> {
  const results: MailApplied[] = [];
  for (const mail of pendingMails(from.sql, to.self)) {
    const applied = await to.inbox.apply({
      mail,
      origin: from.self,
      via: "link",
    });
    assert.ok(applied.ok, JSON.stringify(applied));
    results.push(applied.value);
    const recorded = await from.command(callsMailSent, {
      mail: mail.id,
      result: { kind: "acked", applied: applied.value },
    });
    assert.ok(recorded.ok, JSON.stringify(recorded));
  }
  return results;
}

const code = (done: Result<unknown>) => (done.ok ? "ok" : done.error.code);
const later = (ms: number) => {
  clock.ms += ms;
};
// 보낸 session에 기록된 실패 알림의 이유.
const failures = (m: Machine) =>
  m.db
    .prepare(
      "select fail_reason from messages where fail_reason is not null order by rowid",
    )
    .all()
    .map((row) => row["fail_reason"]);

test("만료된 call mail은 받는 기계에서 session을 열지 않고, 보낸 기계의 call은 sweep에서 expired로 닫혀 보낸 session에 한 번 알린다", async () => {
  clock.ms = START;
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");

  // 받는 기계에 7일 넘게 늦게 닿았다.
  const first = await a.send(sender, B);
  later(MAIL_EXPIRY_MS + 1);
  assert.deepStrictEqual(await carry(a, b), [
    { delivery: "failed", reason: "expired", session: null },
  ]);
  assert.equal(b.count("sessions"), 0);
  assert.equal(b.count("agent_calls"), 0);
  assert.deepStrictEqual(await b.holds(), []);
  assert.equal(a.callRow(first)?.["fail_reason"], "expired");
  // 받는 기계가 낸 실패 mail이 와도 두 번 알리지 않는다.
  await carry(b, a);
  assert.deepStrictEqual(failures(a), ["expired"]);

  // 받는 기계에 닿지 못했다: 보낸 기계의 sweep이 닫는다. 다시 돌아도 한 번이다.
  const second = await a.send(sender, B);
  later(MAIL_EXPIRY_MS - 1);
  await a.tick();
  assert.equal(a.callRow(second)?.["state"], "accepted");
  later(2);
  a.forget();
  await a.tick();
  await a.tick();
  assert.equal(a.callRow(second)?.["state"], "failed");
  assert.equal(a.callRow(second)?.["fail_reason"], "expired");
  assert.equal(a.count("mail_outbox"), 0);
  assert.deepStrictEqual(failures(a), ["expired", "expired"]);

  // 받는 기계의 대기 목록에서 아무도 정하지 않았다: 받는 기계의 sweep이 닫고 보낸 기계에 실패를 알린다.
  const third = await a.send(sender, B);
  later(MAIL_LATE_MS + 1);
  await carry(a, b);
  assert.equal(a.callRow(third)?.["delivery"], "held");
  later(MAIL_EXPIRY_MS);
  // sweep 전에도 만료된 줄은 목록에 없다.
  assert.deepStrictEqual(await b.holds(), []);
  await b.tick();
  assert.equal(
    b.count("mail_seen", `call = '${third}' and state = 'expired'`),
    1,
  );
  assert.equal(b.count("mail_seen", "mail is not null"), 0);
  await carry(b, a);
  assert.equal(a.callRow(third)?.["fail_reason"], "expired");
  assert.deepStrictEqual(failures(a), ["expired", "expired", "expired"]);
  assert.equal(b.count("sessions"), 0);

  // 받은 기록은 닿은 뒤 만료의 두 배가 지나야 지운다(그 안에 같은 mail이 다시 와도 한 번만 돈다).
  later(MAIL_EXPIRY_MS);
  await b.tick();
  assert.equal(b.count("mail_seen", `call = '${third}'`), 1);
  later(1);
  await b.tick();
  assert.equal(b.count("mail_seen"), 0);
});

test("10분 넘게 늦게 온 call mail은 session을 열지 않고 대기 목록에 서며, Start now에서만 열리고 Skip이면 skipped 실패 mail이 돌아간다", async () => {
  clock.ms = START;
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  // 10분 안에 닿은 mail은 묻지 않고 돈다.
  const prompt = await a.send(sender, B);
  later(MAIL_LATE_MS);
  assert.equal((await carry(a, b))[0]?.delivery, "running");
  assert.equal(b.count("sessions"), 1);

  const run = await a.send(sender, B);
  const skip = await a.send(sender, B);
  const cancelled = await a.send(sender, B);
  later(MAIL_LATE_MS + 1);
  const mails = pendingMails(a.sql, B);
  assert.deepStrictEqual(
    (await carry(a, b)).map((applied) => applied.delivery),
    ["held", "held", "held"],
  );
  // 같은 mail이 다시 와도 대기 줄 하나다.
  assert.deepStrictEqual(
    await b.inbox.apply({ mail: mails[0]!, origin: A, via: "link" }),
    { ok: true, value: { delivery: "held", reason: null, session: null } },
  );
  assert.equal(b.count("mail_seen", "state = 'held'"), 3);
  assert.equal(b.count("sessions"), 1);
  assert.equal(b.count("agent_calls"), 1);
  for (const call of [run, skip, cancelled]) {
    assert.equal(a.callRow(call)?.["delivery"], "held");
  }
  const holds = await b.holds();
  assert.deepStrictEqual(
    holds.map((hold) => [hold.mail, hold.computer, hold.text]),
    mails.map((mail) => [mail.id, "laptop", TEXT]),
  );
  // 화면에 가는 바뀜에는 본문이 없다.
  assert.ok(
    b.changes.some((change) => JSON.stringify(change).includes("mail_holds")),
  );
  assert.ok(!b.changes.some((change) => JSON.stringify(change).includes(TEXT)));

  // 보낸 쪽이 그 사이 취소했다: 받는 기계의 줄도 닫히고 정할 수 없다.
  const withdrawn = await a.command(callCancel, { call: cancelled }, PERSON);
  assert.ok(withdrawn.ok, JSON.stringify(withdrawn));
  await carry(a, b);
  assert.equal(code(await b.decide(A, mails[2]!.id, "run_now")), "conflict");
  assert.equal(a.callRow(cancelled)?.["state"], "cancelled");
  assert.equal(b.count("mail_seen", "state = 'cancelled'"), 1);

  // Start now: 그때 session이 열리고 받은 글이 기록되며, 보낸 기계는 running과 그 session을 안다.
  b.forget();
  const started = await b.decide(A, mails[0]!.id, "run_now");
  assert.ok(started.ok, JSON.stringify(started));
  const session = (started.value as MailApplied).session;
  assert.equal((started.value as MailApplied).delivery, "running");
  assert.equal(b.count("sessions"), 2);
  assert.equal(b.count("messages", `session = '${session}'`), 1);
  await carry(b, a);
  assert.equal(a.callRow(run)?.["delivery"], "running");
  assert.equal(a.callRow(run)?.["remote_session"], session);

  // Skip: session을 열지 않고 보낸 쪽 call이 skipped로 닫혀 보낸 session에 알린다.
  const skipped = await b.decide(A, mails[1]!.id, "skip");
  assert.deepStrictEqual(skipped, {
    ok: true,
    value: { delivery: "failed", reason: "skipped", session: null },
  });
  await carry(b, a);
  assert.equal(a.callRow(skip)?.["state"], "failed");
  assert.equal(a.callRow(skip)?.["fail_reason"], "skipped");
  assert.deepStrictEqual(failures(a), ["skipped"]);

  // 두 번 정하면 conflict이고 아무것도 더 나가지 않는다. 없는 줄은 not_found다.
  for (const [mail, decision] of [
    [mails[0]!.id, "skip"],
    [mails[0]!.id, "run_now"],
    [mails[1]!.id, "run_now"],
  ] as const) {
    assert.equal(code(await b.decide(A, mail, decision)), "conflict");
  }
  assert.equal(
    code(await b.decide(A, "mal_0zzzzzzzzzzzzzzzzzzzzzzzzz", "run_now")),
    "not_found",
  );
  assert.equal(b.count("mail_outbox"), 0);
  assert.equal(b.count("sessions"), 2);
  assert.deepStrictEqual(await b.holds(), []);
  assert.equal(b.count("mail_seen", "mail is not null"), 0);
  assert.equal(a.callRow(prompt)?.["delivery"], "running");

  // 정하기 전에 만료됐다: Start now는 conflict이고 줄은 expired로 닫히며 보낸 쪽 call도 expired로 닫힌다.
  const stale = await a.send(sender, B);
  later(MAIL_LATE_MS + 1);
  const [staleMail] = pendingMails(a.sql, B);
  await carry(a, b);
  later(MAIL_EXPIRY_MS);
  assert.equal(code(await b.decide(A, staleMail!.id, "run_now")), "conflict");
  assert.equal(b.count("sessions"), 2);
  await carry(b, a);
  assert.equal(a.callRow(stale)?.["fail_reason"], "expired");
  assert.equal(code(await b.decide(A, staleMail!.id, "run_now")), "conflict");
});

test("held mail의 Start now는 그때 그 컴퓨터의 터미널 입력 허락으로 skip을 정한다", async () => {
  clock.ms = START;
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  // 닿을 때 허락이 없었고 정할 때 있다. 다음 것은 그 반대다.
  await a.send(sender, B, "skipper");
  later(MAIL_LATE_MS + 1);
  await carry(a, b);
  b.grants.add(A);
  await a.send(sender, B, "skipper");
  later(MAIL_LATE_MS + 1);
  await carry(a, b);
  const [granted, revoked] = await b.holds();
  assert.ok(granted !== undefined && revoked !== undefined);
  assert.ok((await b.decide(A, granted.mail, "run_now")).ok);
  b.grants.delete(A);
  assert.ok((await b.decide(A, revoked.mail, "run_now")).ok);
  assert.deepStrictEqual(
    b.db
      .prepare("select skip from sessions order by created_seq")
      .all()
      .map((row) => row["skip"]),
    [1, 0],
  );
});

test("대기 중인 mail은 그 컴퓨터의 사람만 정한다: agent 자격, 보낸 컴퓨터, 허락 없는 폰, 터미널 요청은 forbidden이고 허락받은 폰의 화면은 정한다", async () => {
  clock.ms = START;
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  await a.send(sender, B);
  later(MAIL_LATE_MS + 1);
  await carry(a, b);
  const [hold] = await b.holds();
  assert.ok(hold !== undefined);
  const decision = { origin: A, mail: hold.mail, decision: "run_now" };

  // B의 기기 연결: 보낸 컴퓨터 A와 폰이 명단에 있다.
  const registry = new CredentialRegistry({
    epoch: "test",
    random: seededRandom(7),
    clock: manualClock(START),
    operations: [...REMOTE_ALLOWED_ROUTES, ...REMOTE_PERSON_ROUTES].map(
      (route) => ({
        name: route.name,
        actors: ["user"],
        kind: route.kind === "command" ? "command" : "read",
      }),
    ),
  });
  const memory = new Map<string, MemoryHandler>([
    ["mail/holds", holdsHandler(b.entry)],
    ["mail/decide_hold", decideHoldHandler(b.entry)],
  ]);
  const routes = new RouteRegistry([mailHolds, mailDecideHold]);
  // 이 컴퓨터에서 터미널 입력을 허락받은 기기.
  const grantedDevices = new Set<string>();
  const call = createRemoteCall({
    registry,
    routes,
    clock: manualClock(START),
    reads: new Map(),
    memory,
    writer: {
      command: async () => err({ code: "internal", message: "unused" }),
      readResult: async () => ok(null),
      close: async () => {},
    },
    admission: createAdmission(),
    granted: (principal) => grantedDevices.has(principal),
    kind: (principal) =>
      principal === devicePrincipal(A_DEV)
        ? "computer"
        : principal === devicePrincipal(PHONE)
          ? "phone"
          : null,
    privateApp: () => false,
    confirm: async () => err({ code: "internal", message: "unused" }),
  });
  const devices = createDeviceCredentials({
    registry,
    record: async () => ok(undefined),
  });
  const remote = async (
    device: string,
    method: string,
    body: unknown,
    by?: Requester,
  ) => {
    const credential = await devices.get(device);
    assert.ok(credential.ok);
    return await call(credential.value, {
      resource: "mail",
      method,
      body,
      ...(by === undefined ? {} : { by }),
    });
  };
  const AGENT: Requester = {
    kind: "agent",
    agent: "lophn_home",
    session: null,
    name: "lophn",
  };

  // 목록은 허락 없는 폰도 읽는다.
  assert.equal(code(await remote(PHONE, "holds", {})), "ok");
  const refused: [string, () => Promise<Result<unknown>>][] = [
    ["phone without grant", () => remote(PHONE, "decide_hold", decision)],
    [
      "sending computer's screen without grant",
      () => remote(A_DEV, "decide_hold", decision, { kind: "screen" }),
    ],
    [
      "sending computer's agent",
      () => remote(A_DEV, "decide_hold", decision, AGENT),
    ],
  ];
  for (const [who, run] of refused) {
    assert.equal(code(await run()), "forbidden", who);
  }
  grantedDevices.add(devicePrincipal(A_DEV));
  for (const by of [AGENT, { kind: "terminal" } as Requester]) {
    assert.equal(
      code(await remote(A_DEV, "decide_hold", decision, by)),
      "forbidden",
      `granted computer's ${by.kind}`,
    );
  }
  // 이 컴퓨터의 agent session 자격.
  const agentCall = await dispatchHttp(
    new Request("http://local/mail/decide_hold", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision),
    }),
    routes.lookup("/mail/decide_hold")!,
    {
      principal: "agent:ses_00000000000000000000000001",
      actor: "agent:ses_00000000000000000000000001",
      scope: { operations: [], targets: {} },
      conditions: {},
      credential_ref: "agent",
    } as AuthenticatedContext,
    {
      credentials: registry,
      clock: manualClock(START),
      memory,
      bodyTimeoutMs: 1000,
      jsonMaxBytes: 1 << 20,
    },
  );
  assert.equal(
    (agentCall as { json: { error?: { code: string } } }).json.error?.code,
    "forbidden",
  );
  assert.equal(b.count("mail_seen", "state = 'held'"), 1);
  assert.equal(b.count("sessions"), 0);

  // 허락받은 폰의 화면은 이 컴퓨터의 사람이다.
  grantedDevices.add(devicePrincipal(PHONE));
  const started = await remote(PHONE, "decide_hold", decision);
  assert.ok(started.ok, JSON.stringify(started));
  assert.equal((started.value as MailApplied).delivery, "running");
  assert.equal(b.count("sessions"), 1);
});
