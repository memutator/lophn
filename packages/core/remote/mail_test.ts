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
import { createProductRedactor } from "../../base/redaction/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { Route } from "../../protocol/base/mod.ts";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
} from "../../protocol/lophn-agent/call-policy.ts";
import { textBlocks } from "../../protocol/lophn-agent/content-block.ts";
import { a2aMail, type Mail } from "../../protocol/lophn-agent/mail.ts";
import {
  isLophn,
  lophnIdOf,
  type Workspace,
  workspaceOfLophn,
} from "../../protocol/lophn-agent/workspaces.ts";
import {
  type MachineCandidate,
  type Requester,
  resolveMachine,
} from "../../protocol/machine/requester.ts";
import type {
  AuthenticatedContext,
  SchemaStep,
  Sql,
  Tx,
} from "../../protocol/server/mod.ts";
import {
  REMOTE_ALLOWED_ROUTES,
  REMOTE_PERSON_ROUTES,
} from "../../protocol/remote/mod.ts";
import type { RemoteMachines } from "../apps/calls/forward.ts";
import { createWorkspaceNameRules } from "../agent-workspaces/workspace/session-directory.ts";
import type { AgentDirectory } from "../lophn-agent/agents/directory.ts";
import { createLophnInputTransport } from "../lophn-agent/run-loop/mod.ts";
import {
  type BodyPrepare,
  redactBlocks,
} from "../lophn-agent/session/message-body.ts";
import {
  createReceivedRecorder,
  createSessionDirectory,
} from "../lophn-agent/workspaces/mod.ts";
import { TEAMS, WIRINGS } from "../main/daemon/assembly.ts";
import { assemble } from "../main/daemon/registration.ts";
import { createCallBodyPreparer } from "../main/daemon/wiring/router.ts";
import {
  callsMailSent,
  createCallStore,
  createMailOutbox,
  createMailSeen,
  installRouterEnvironment,
  outboxPeers,
  pendingMails,
  type RouterDeps,
  ROUTER_COMMANDS,
} from "../router/mod.ts";
import { CredentialRegistry } from "../server/identity/mod.ts";
import { type MemoryHandler, RouteRegistry } from "../server/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import { createAdmission } from "../supervision/responsiveness/mod.ts";
import {
  createDeviceCredentials,
  createRemoteCall,
  devicePrincipal,
  requesterOf,
} from "./call.ts";
import { createMailDrain } from "./mail-drain.ts";
import {
  createMailInbox,
  type MailEntryDeps,
  mailHandler,
  sendRemoteHandler,
} from "./mail-entry.ts";

// 기계 사이 mail의 권한 경계다. 두 기계마다 실제 ledger schema(SQLite 하나), Router 명령, store, session directory, 받은 입력 기록을 두고,
// 입구 handler에서 시작해 기기 연결의 call 처리, writer 명령, Router까지 한 번 잇는다. 명단 밖 기기가 mail을 넣거나, 허락 없는 컴퓨터의
// mail이 skip으로 돌거나, private workspace가 다른 컴퓨터로 나가거나, 옛 판의 상대가 그 기계의 줄을 영영 막으면 곤란하다.

const A = "mch_0aaaaaaaaaaaaaaaaaaaaaaaaa" as Id<"mch">;
const B = "mch_0bbbbbbbbbbbbbbbbbbbbbbbbb" as Id<"mch">;
const C = "mch_0ccccccccccccccccccccccccc" as Id<"mch">;
const A_DEV = "dev_0aaaaaaaaaaaaaaaaaaaaaaaaa" as Id<"dev">;
const B_DEV = "dev_0bbbbbbbbbbbbbbbbbbbbbbbbb" as Id<"dev">;
const C_DEV = "dev_0ccccccccccccccccccccccccc" as Id<"dev">;
// A의 옛 항목: 같은 기계 id의 다른 기기.
const A_OLD_DEV = "dev_0aaaaaaaaaaaaaaaaaaaaaaaab" as Id<"dev">;
// 제품 redaction이 pattern으로 거르는 값.
const SECRET = "sk-abcdefghijklmnopqrstuvwxyz012345";
const PHONE = "dev_0ppppppppppppppppppppppppp" as Id<"dev">;
const STRANGER = "dev_0sssssssssssssssssssssssss" as Id<"dev">;
const PROJECT = "prj_00000000000000000000000001";
const IDENTITY = "pri_00000000000000000000000001";
const REVIEWER = "agt_00000000000000000000000001";
// 정의가 skip인 agent.
const SKIPPER = "agt_00000000000000000000000002";
const MAIL_PRINCIPAL = "machine:mail";

// 명단: 세 컴퓨터와 A의 옛 항목, 폰 하나. 모르는 기기는 명단에 없다. 기계마다 앞 항목이 그 기계 자신이다.
const ROSTER: (MachineCandidate & { kind: "computer" })[] = [
  { machine: A, device: A_DEV, name: "laptop", self: false, kind: "computer" },
  {
    machine: A,
    device: A_OLD_DEV,
    name: "laptop-old",
    self: false,
    kind: "computer",
  },
  { machine: B, device: B_DEV, name: "studio", self: false, kind: "computer" },
  { machine: C, device: C_DEV, name: "tower", self: false, kind: "computer" },
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
  root = await mkdtemp(join(tmpdir(), "mail-link-"));
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
const directoryOf = (sql: Sql) =>
  createSessionDirectory({
    projects,
    apps,
    agents,
    names: createWorkspaceNameRules({ projects, apps, agents }),
    publish: () => {},
    sql: () => sql,
  });

// Router 명령은 설치된 환경으로 Router를 만든다. 환경은 tx의 sql로 기계를 고른다.
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

const preparedKey = (k: { hash: string; principal: string; purpose: string }) =>
  `${k.principal} ${k.purpose} ${k.hash}`;

let machines = 0;

// 한 기계: 빈 ledger, 실제 Router 명령·store·directory·받은 입력 기록, 본문 준비(router wiring의 층)와 준비된 blob만 받는 기록.
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
  const tx = {
    sql,
    now: () => "2026-11-21T00:00:00.000Z",
    newId: (prefix: string) =>
      `${prefix}_0${String(index * 1_000_000 + ++counter).padStart(25, "0")}`,
    port: () => ({ push: () => {}, principal: () => MAIL_PRINCIPAL }),
    // 받은 입력의 본문은 그 자격으로 미리 준비된 blob이어야 기록된다(writer가 하는 검사).
    registerBlobRef: (ref: {
      source: { blob: { hash: string; principal: string; purpose: string } };
    }) =>
      prepared.has(preparedKey(ref.source.blob))
        ? ok({})
        : err({ code: "invalid_input", message: "body was not prepared" }),
  } as unknown as Tx;
  const policy: { value: CallPolicy } = { value: DEFAULT_CALL_POLICY };
  routerDepsBySql.set(sql, {
    directory: {
      ...directoryOf(sql),
      projectOfIdentity: (identity: string) =>
        identity === IDENTITY ? PROJECT : null,
      identityOfProject: () => ok(IDENTITY),
    },
    transport: createLophnInputTransport({
      record: createReceivedRecorder({ principal: () => MAIL_PRINCIPAL })
        .record,
    }),
    store: createCallStore(),
    outbox: createMailOutbox(),
    seen: createMailSeen(),
    self: () => self,
    callPolicy: () => policy.value,
    announce: () => {},
  } as unknown as RouterDeps);

  // 받는 session 기록에 쓰려고 준비한 글.
  const preparedTexts: string[] = [];
  const relay: BodyPrepare = {
    live: (k) => prepared.has(preparedKey(k)),
    async prepare(call) {
      const bytes = Buffer.from(await new Response(call.bytes).arrayBuffer());
      const hash = createHash("sha256").update(bytes).digest("hex");
      prepared.add(preparedKey({ ...call, hash }));
      preparedTexts.push(bytes.toString("utf8"));
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
  ): Promise<Result<unknown>> => {
    const ready = await preparer(MAIL_CONTEXT, {
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
        MAIL_CONTEXT as never,
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

  // 이 기계가 보는 명단과 link. call은 test가 정한다.
  const status = new Map<string, "connected" | "offline">(
    ROSTER.map((each) => [each.machine, "connected"]),
  );
  const link: {
    call: (
      device: string,
      body: { resource: string; method: string; body: unknown },
      by: Requester,
    ) => Promise<Result<unknown>>;
  } = { call: async () => err({ code: "unavailable", message: "no link" }) };
  const own = ROSTER.find((each) => each.machine === self)!.device;
  const computers = () =>
    ROSTER.map(({ machine, device, name }) => ({
      machine,
      device,
      name,
      self: device === own,
    }));
  const links: RemoteMachines = {
    computers,
    list: () =>
      ROSTER.filter((each) => each.device !== own).map((each) => ({
        machine: each.machine as Id<"mch">,
        name: each.name,
        status: status.get(each.machine)!,
      })),
    resolve: (ref) => resolveMachine(ref, computers()),
    call: (device, body, by) => link.call(device, body, by),
  };
  const kinds = new Map<string, "phone" | "computer">([
    ...ROSTER.map((each) => [devicePrincipal(each.device), each.kind] as const),
    [devicePrincipal(PHONE), "phone"],
  ]);
  // 이 컴퓨터에서 터미널 입력을 허락받은 기계.
  const grants = new Set<string>();
  const entry: MailEntryDeps = {
    command,
    sql,
    policy: () => policy.value,
    computers: links.computers,
    resolve: links.resolve,
    self: () => self,
    redact: (blocks) => redactBlocks(createProductRedactor(), blocks),
    kind: (principal) => kinds.get(principal) ?? null,
    granted: (machine) => grants.has(machine),
    requesterOf,
    prepare: async () => ok(undefined),
    now: () => "2026-11-21T00:00:00.000Z",
  };
  // drain의 주기 timer. test가 손으로 돌린다.
  let timer: (() => Promise<void>) | undefined;
  const drain = createMailDrain({
    peers: () => outboxPeers(sql),
    pending: (peer) => pendingMails(sql, peer),
    connected: (peer) =>
      links
        .list()
        .some((each) => each.machine === peer && each.status === "connected")
        ? ROSTER.find((each) => each.machine === peer)!.device
        : null,
    call: links.call,
    record: (mail, result) => command(callsMailSent, { mail, result }),
    sweep: async () => ok({}),
    every(_ms, fn) {
      timer = fn;
      return () => {
        timer = undefined;
      };
    },
    warn: () => {},
  });

  // 기기 연결로 들어오는 call(받는 쪽). routes가 a2a/mail을 모르면 옛 판이다.
  const remote = (routes: Route[] = [a2aMail]) => {
    const registry = new CredentialRegistry({
      epoch: "test",
      random: seededRandom(index),
      clock: manualClock(Date.parse("2026-11-21T00:00:00.000Z")),
      operations: [...REMOTE_ALLOWED_ROUTES, ...REMOTE_PERSON_ROUTES].map(
        (route) => ({
          name: route.name,
          actors: ["user"],
          kind: route.kind === "command" ? "command" : "read",
        }),
      ),
    });
    const call = createRemoteCall({
      registry,
      routes: new RouteRegistry(routes),
      clock: manualClock(Date.parse("2026-11-21T00:00:00.000Z")),
      reads: new Map(),
      memory: new Map<string, MemoryHandler>([
        ["a2a/mail", mailHandler(entry)],
      ]),
      writer: {
        command: async () => err({ code: "internal", message: "unused" }),
        readResult: async () => ok(null),
        close: async () => {},
      },
      admission: createAdmission(),
      granted: () => false,
      kind: entry.kind,
      privateApp: () => false,
      confirm: async () => err({ code: "internal", message: "unused" }),
    });
    const devices = createDeviceCredentials({
      registry,
      record: async () => ok(undefined),
    });
    return async (device: string, body: unknown, by?: Requester) => {
      const credential = await devices.get(device);
      assert.ok(credential.ok);
      return call(credential.value, {
        resource: "a2a",
        method: "mail",
        body,
        ...(by === undefined ? {} : { by }),
      });
    };
  };

  const count = (table: string) =>
    Number(db.prepare(`select count(*) as n from ${table}`).get()?.["n"]);
  const callRow = (id: string) =>
    db
      .prepare(
        "select state, fail_reason, delivery from agent_calls where call = ?",
      )
      .get(id);
  // 사람이 여는 session.
  const openSession = (agent: string, workspace: Workspace | null = null) => {
    const opened = directoryOf(sql).open(
      tx,
      { agent, workspace },
      { kind: "human" },
      null,
    );
    assert.ok(opened.ok);
    return opened.value.session;
  };
  // 그 session의 agent가 부르는 `calls/send_remote`.
  const sendRemote = async (
    session: string,
    to: object,
    dedup: string,
    text = "review the branch",
  ) =>
    await sendRemoteHandler(entry)(
      {
        principal: `agent:${session}`,
        actor: `agent:${session}`,
        scope: { operations: [], targets: {} },
        conditions: { session: session as Id<"ses"> },
        credential_ref: "agent",
      } as AuthenticatedContext,
      { to, reply: "result", body: textBlocks(text), dedup },
    );
  return {
    self,
    db,
    sql,
    policy,
    status,
    link,
    grants,
    entry,
    drain,
    tick: () => timer!(),
    preparedTexts,
    remote,
    count,
    callRow,
    openSession,
    sendRemote,
    inbox: createMailInbox(entry),
  };
}

type Machine = Awaited<ReturnType<typeof machine>>;

// from의 link가 to의 기기 연결로 닿는다. from은 to의 명단에서 그 컴퓨터의 기기다.
function connect(from: Machine, to: Machine, routes?: Route[]) {
  const receive = to.remote(routes);
  const device = ROSTER.find((each) => each.machine === from.self)!.device;
  const sent: string[] = [];
  from.link.call = async (_device, body, by) => {
    sent.push((body.body as { mail: Mail }).mail.id);
    return await receive(device, body.body, by);
  };
  return { receive, sent };
}

const AGENT_BY: Requester = {
  kind: "agent",
  agent: "lophn_home",
  session: null,
  name: "lophn",
};
const code = (done: Result<unknown>) => (done.ok ? "ok" : done.error.code);
const HOME_REVIEWER = { agent: "reviewer", workspace: { home: true } };

test("명단의 컴퓨터가 아닌 기기(폰, 모르는 기기, from.machine이 link의 기계와 다른 mail)가 보낸 mail은 Router에 닿지 않는다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  const sent = await a.sendRemote(
    sender,
    { ...HOME_REVIEWER, machine: "studio" },
    "t1",
    `use ${SECRET}`,
  );
  assert.equal(code(sent), "ok");
  // 보내는 쪽 redaction: outbox에 secret이 남지 않는다.
  assert.ok(
    !a.sql
      .all("select mail from mail_outbox", [])
      .some((row) => String(row["mail"]).includes(SECRET)),
  );
  const [mail] = pendingMails(a.sql, B);
  assert.ok(mail !== undefined);
  const receive = b.remote();
  // 기기 연결의 call 처리를 지나 요청한 쪽이 실린 것처럼 handler를 바로 부른다.
  const direct = (device: string) =>
    mailHandler({ ...b.entry, requesterOf: () => AGENT_BY })(
      {
        principal: devicePrincipal(device),
        actor: "user",
        scope: { operations: [], targets: {} },
        conditions: {},
        credential_ref: device,
      },
      { mail },
    );
  const rows: [string, () => Promise<Result<unknown>>][] = [
    ["phone", () => receive(PHONE, { mail })],
    ["unknown device", () => receive(STRANGER, { mail })],
    ["phone as agent", async () => await direct(PHONE)],
    ["unknown device as agent", async () => await direct(STRANGER)],
    // 사람의 터미널이 시킨 것은 mail이 아니다.
    ["terminal", () => receive(A_DEV, { mail }, { kind: "terminal" })],
    // 다른 컴퓨터가 A의 mail을 실어 온다.
    ["relayed by C", () => receive(C_DEV, { mail }, AGENT_BY)],
    // A가 C에게 쓴 mail을 B에 넣는다.
    [
      "addressed to C",
      () => receive(A_DEV, { mail: { ...mail, to_machine: C } }, AGENT_BY),
    ],
    // 폴더 길: 명단 밖 기계, 다른 컴퓨터의 폴더에서 온 A의 mail.
    [
      "folder of a stranger",
      () =>
        b.inbox.apply({
          mail,
          origin: "mch_0ddddddddddddddddddddddddd" as Id<"mch">,
          via: "folder",
        }),
    ],
    ["folder of C", () => b.inbox.apply({ mail, origin: C, via: "folder" })],
    // 폴더 길: 이 기계가 이 기계에게 쓴 것처럼 꾸민 mail.
    [
      "folder of this computer",
      () =>
        b.inbox.apply({
          mail: { ...mail, from: { ...mail.from, machine: B }, to_machine: B },
          origin: B,
          via: "folder",
        }),
    ],
  ];
  for (const [who, run] of rows) {
    assert.equal(code(await run()), "forbidden", who);
  }
  for (const table of [
    "mail_seen",
    "mail_outbox",
    "agent_calls",
    "sessions",
    "messages",
  ]) {
    assert.equal(b.count(table), 0, table);
  }
  // 그 컴퓨터의 link로 온 그 컴퓨터의 mail은 닿는다. 받는 쪽도 redaction을 거쳐 받는 session 기록의 글에 secret이 없다.
  const applied = await receive(
    A_DEV,
    { mail: { ...mail, body: textBlocks(`use ${SECRET}`) } },
    AGENT_BY,
  );
  assert.ok(applied.ok, JSON.stringify(applied));
  assert.equal((applied.value as { delivery: string }).delivery, "running");
  assert.equal(b.count("sessions"), 1);
  assert.equal(b.count("messages"), 1);
  assert.ok(b.preparedTexts.length > 0);
  assert.ok(!b.preparedTexts.some((text) => text.includes(SECRET)));
});

test("터미널 입력 허락이 없는 컴퓨터가 보낸 mail로 열린 session은 skip인 agent여도 묻는 session이고, 허락이 있는 컴퓨터면 agent의 skip을 따른다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  connect(a, b);
  const sender = a.openSession("lophn_home");
  const to = { agent: "skipper", workspace: { home: true }, machine: "studio" };
  assert.equal(code(await a.sendRemote(sender, to, "t1")), "ok");
  await a.drain.wake(B);
  b.grants.add(A);
  assert.equal(code(await a.sendRemote(sender, to, "t2")), "ok");
  await a.drain.wake(B);
  assert.deepStrictEqual(
    b.db
      .prepare("select skip from sessions order by created_seq")
      .all()
      .map((row) => row["skip"]),
    [0, 1],
  );
  assert.equal(a.count("mail_outbox"), 0);
});

test("private workspace의 session과 받은 mail로 열린 session은 send_remote가 forbidden이고 outbox에 줄이 생기지 않는다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  connect(a, b);
  a.policy.value = {
    ...DEFAULT_CALL_POLICY,
    private: [{ kind: "project", id: PROJECT as Id<"prj"> }],
  };
  const project: Workspace = { kind: "project", id: PROJECT as Id<"prj"> };
  const hidden = a.openSession(lophnIdOf(project), project);
  // 명단의 컴퓨터 이름을 풀기 전에 막는다(없는 이름도 forbidden).
  for (const name of ["studio", "nowhere"]) {
    assert.equal(
      code(
        await a.sendRemote(hidden, { ...HOME_REVIEWER, machine: name }, name),
      ),
      "forbidden",
      name,
    );
  }
  assert.equal(a.count("mail_outbox"), 0);
  assert.equal(a.count("agent_calls"), 0);

  a.policy.value = DEFAULT_CALL_POLICY;
  const sender = a.openSession("lophn_home");
  // 이 컴퓨터와, 같은 기계 id의 옛 명단 항목은 다른 컴퓨터가 아니다.
  for (const name of ["laptop", "laptop-old"]) {
    assert.equal(
      code(
        await a.sendRemote(sender, { ...HOME_REVIEWER, machine: name }, name),
      ),
      "invalid_input",
      name,
    );
  }
  assert.equal(a.count("mail_outbox"), 0);
  const sent = await a.sendRemote(
    sender,
    { ...HOME_REVIEWER, machine: "studio" },
    "t1",
  );
  assert.equal(code(sent), "ok");
  await a.drain.wake(B);
  const opened = b.db.prepare("select id from sessions").get()?.["id"];
  assert.equal(typeof opened, "string");
  for (const name of ["laptop", "tower", "nowhere"]) {
    assert.equal(
      code(
        await b.sendRemote(
          String(opened),
          { ...HOME_REVIEWER, machine: name },
          name,
        ),
      ),
      "forbidden",
      name,
    );
  }
  assert.equal(b.count("mail_outbox"), 0);
  assert.equal(b.count("agent_calls"), 1);
});

test("drain에서 상대가 not_found로 답하면 call이 old_version으로 닫히고, 답을 잃으면 delivery가 unknown으로 남아 다음 drain에 같은 mail id가 다시 간다", async () => {
  // 옛 판: 그 route를 모른다. 줄의 둘째 mail도 막히지 않고 닫히며, 실패 알림이 보낸 session의 입력으로 기록된다.
  {
    const a = await machine(A);
    const b = await machine(B);
    connect(a, b, []);
    const sender = a.openSession("lophn_home");
    const calls: string[] = [];
    for (const dedup of ["t1", "t2"]) {
      const sent = await a.sendRemote(
        sender,
        { ...HOME_REVIEWER, machine: "studio" },
        dedup,
      );
      assert.ok(sent.ok);
      calls.push((sent.value as { call: string }).call);
    }
    await a.drain.wake(B);
    for (const call of calls) {
      assert.equal(a.callRow(call)?.["state"], "failed");
      assert.equal(a.callRow(call)?.["fail_reason"], "old_version");
    }
    assert.equal(a.count("mail_outbox"), 0);
    assert.deepStrictEqual(
      a.db
        .prepare("select session, fail_reason from messages")
        .all()
        .map((row) => ({ ...row })),
      calls.map(() => ({ session: sender, fail_reason: "old_version" })),
    );
  }
  // 답을 잃음: 그 기계가 적용했는데 답이 오지 않았다. 그 기계의 줄은 거기서 멈추고, 다음 drain에 같은 id로 다시 가며 받는 쪽은 한 번만
  // 돌린다. 한 기계에 두 깨움이 겹쳐도 보내기는 하나씩이다.
  {
    const a = await machine(A);
    const b = await machine(B);
    const { receive, sent } = connect(a, b);
    const sender = a.openSession("lophn_home");
    const calls: string[] = [];
    for (const dedup of ["t1", "t2"]) {
      const done = await a.sendRemote(
        sender,
        { ...HOME_REVIEWER, machine: "studio" },
        dedup,
      );
      assert.ok(done.ok);
      calls.push((done.value as { call: string }).call);
    }
    const [first, second] = pendingMails(a.sql, B).map((mail) => mail.id);
    a.link.call = async (_device, body, by) => {
      sent.push((body.body as { mail: Mail }).mail.id);
      await receive(A_DEV, body.body, by);
      return err({
        code: "unavailable",
        message: "connection lost",
        details: { sent: true },
      });
    };
    await a.drain.wake(B);
    assert.deepStrictEqual(sent, [first]);
    assert.equal(a.callRow(calls[0]!)?.["delivery"], "unknown");
    assert.equal(a.callRow(calls[1]!)?.["delivery"], "pending");
    assert.equal(a.count("mail_outbox"), 2);

    let flying = 0;
    let most = 0;
    a.link.call = async (_device, body, by) => {
      sent.push((body.body as { mail: Mail }).mail.id);
      most = Math.max(most, ++flying);
      try {
        return await receive(A_DEV, body.body, by);
      } finally {
        flying--;
      }
    };
    await Promise.all([a.drain.wake(B), a.drain.wake(B)]);
    assert.equal(most, 1);
    assert.deepStrictEqual(sent, [first, first, second]);
    for (const call of calls) {
      assert.equal(a.callRow(call)?.["state"], "accepted");
      assert.equal(a.callRow(call)?.["delivery"], "running");
    }
    assert.equal(a.count("mail_outbox"), 0);
    assert.equal(b.count("sessions"), 2);
    assert.equal(b.count("agent_calls"), 2);
    assert.equal(b.count("messages"), 2);
  }
});
test("받는 기계가 줄 맨 앞 mail에 timer가 시작한 차례마다 internal로 답하면 다섯 번째에 그 call을 expired로 닫고 다음 mail이 가며, 네 번이나 timer가 아닌 깨움은 세지 않는다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const { receive } = connect(a, b);
  const sender = a.openSession("lophn_home");
  const calls: string[] = [];
  for (const dedup of ["t1", "t2"]) {
    const done = await a.sendRemote(
      sender,
      { ...HOME_REVIEWER, machine: "studio" },
      dedup,
    );
    assert.ok(done.ok);
    calls.push((done.value as { call: string }).call);
  }
  const [poison] = pendingMails(a.sql, B);
  assert.ok(poison !== undefined);
  a.link.call = async (_device, body, by) =>
    (body.body as { mail: Mail }).mail.id === poison.id
      ? err({ code: "internal", message: "the apply threw" })
      : await receive(A_DEV, body.body, by);
  a.drain.start();
  // 줄이 생기거나 link가 바뀐 깨움은 몰려 와도 세지 않는다.
  for (let i = 0; i < 6; i++) await a.drain.wake(B);
  for (let i = 0; i < 4; i++) await a.tick();
  assert.equal(a.callRow(calls[0]!)?.["state"], "accepted");
  assert.equal(a.callRow(calls[1]!)?.["delivery"], "pending");
  assert.equal(a.count("mail_outbox"), 2);

  await a.tick();
  assert.equal(a.callRow(calls[0]!)?.["state"], "failed");
  assert.equal(a.callRow(calls[0]!)?.["fail_reason"], "expired");
  assert.equal(a.callRow(calls[1]!)?.["delivery"], "running");
  assert.equal(a.count("mail_outbox"), 0);
  assert.equal(b.count("sessions"), 1);
  // 보낸 session에 실패 알림이 기록된다.
  assert.deepStrictEqual(
    a.db
      .prepare("select fail_reason from messages")
      .all()
      .map((row) => row["fail_reason"]),
    ["expired"],
  );
});
