import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  err,
  type Logger,
  manualClock,
  ok,
  type Result,
} from "../../base/mod.ts";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
  isPrivate,
} from "../../protocol/lophn-agent/call-policy.ts";
import type {
  CallReply,
  RemoteAddress,
} from "../../protocol/lophn-agent/calls.ts";
import {
  blocksText,
  textBlocks,
} from "../../protocol/lophn-agent/content-block.ts";
import {
  type Mail,
  type MailApplied,
  mailSchema,
} from "../../protocol/lophn-agent/mail.ts";
import type { Participant } from "../../protocol/workflows/mod.ts";
import { createWorkflowCommands } from "../workflows/commands.ts";
import { parseDeclaration } from "../workflows/declaration.ts";
import { planHandoff } from "../workflows/plan.ts";
import type { WorkflowRemote } from "../workflows/ports.ts";
import {
  remoteHandOf,
  remoteStepFailed,
  remoteStepsOf,
} from "../workflows/remote.ts";
import { createWorkflowService } from "../workflows/service.ts";
import { loadInstance, loadLines } from "../workflows/store.ts";
import {
  isLophn,
  type Workspace,
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
import type { Id } from "../../protocol/base/ids.ts";
import type { CallSignals } from "../lophn-agent/run-loop/ports.ts";
import { interruptRunningTurns } from "../lophn-agent/run-loop/interrupt.ts";
import type { CallFailReason } from "../../protocol/lophn-agent/calls.ts";
import { createMailInbox, type MailEntryDeps } from "../remote/mail-entry.ts";
import { callsMailApply, callsMailRefuse } from "./commands.ts";
import type { RoutedInput } from "./ports.ts";
import { LEFT_ROSTER_TEXT, TAKEN_RESTART_TEXTS } from "./model.ts";
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
// workflow 참가자의 on이 푸는 명단.
const ROSTER = { laptop: A, windows: B, third: C } as const;
const MACHINE = { actor: "machine" } as never;
const SILENT: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: () => Promise.resolve(),
};
// 정의가 skip인 agent.
const SKIPPER = "agt_00000000000000000000000002";

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
          browserProfile: null,
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
            browserProfile: null,
          }
        : null,
  agents: () => [agents.agent(REVIEWER)!, agents.agent(SKIPPER)!],
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
    steps: {
      failed: (tx, call, reason) =>
        remoteStepFailed(tx, call, reason, () => {}),
      changed: () => {},
    },
  });
  // workflow: 실제 command와 service. 명단은 ROSTER, 받은 step은 위 transport가 적은 입력에서 찾는다.
  const commands = createWorkflowCommands(() => ok(router));
  const remote: WorkflowRemote = {
    computer(ref) {
      const machine = ROSTER[ref as keyof typeof ROSTER];
      if (machine === undefined || machine === self) {
        return err({ code: "not_found", message: `no computer ${ref}` });
      }
      return ok({ machine: machine as Id<"mch">, computer: ref });
    },
    workspace: (name) =>
      ok(
        name !== undefined && "home" in name
          ? { home: true }
          : { project: IDENTITY },
      ),
    isPrivate: (project) => isPrivate(policy, { kind: "project", id: project }),
    async receivedStep(session, instance, step) {
      const found = delivered.findLast(
        (each) =>
          each.session === session &&
          each.input.step?.instance === instance &&
          each.input.step.step === step &&
          each.input.call !== null,
      );
      return ok(found?.input.call ?? null);
    },
    async report(input) {
      return router.reportStep(tx, { ...input, unattended: true });
    },
    handOf(call) {
      const hand = remoteHandOf(sql, call);
      return ok(
        hand === null
          ? null
          : { instance: hand.instance as Id<"wfi">, step: hand.step },
      );
    },
  };
  const read = (id: string) => {
    const instance = loadInstance(sql, id);
    const lines = loadLines(sql, id, { after: 0, limit: null });
    assert.ok(instance.ok && instance.value !== null && lines.ok);
    return {
      instance: instance.value,
      last_reports: {},
      lines: lines.value,
      remote_steps: remoteStepsOf(sql, id),
    };
  };
  // project "shop"의 workflows 폴더. test가 선언 글(workflow.yaml)을 넣는다.
  const declarations = new Map<string, string>();
  const workflows = createWorkflowService({
    files: {
      list: async () =>
        ok(
          [...declarations].map(([name, declaration]) => ({
            name,
            declaration,
            flow: false,
            artifacts: { static: false, instance: false },
          })),
        ),
    },
    projects: {
      resolve: async () => ok({ id: PROJECT as Id<"prj">, name: "shop" }),
      nameOf: async () => ok("shop"),
    },
    turns: { stopSession: async () => ok(undefined) } as never,
    flows: { stop: async () => ok(undefined) } as never,
    remote,
    ids: { newId: (prefix: never) => tx.newId(prefix) } as never,
    logger: SILENT,
    store: {
      create: async (input) =>
        commands.create.handle(tx, MACHINE, input, {}) as never,
      apply: async (input, compare) =>
        commands.apply.handle(tx, MACHINE, input, compare) as never,
      read: async (id) =>
        (loadInstance(sql, id) as { value: unknown }).value === null
          ? err({ code: "not_found", message: "workflow instance not found" })
          : (ok(read(id)) as never),
      running: async () => ok([]),
    },
  });
  // mail 입구(link·폴더가 같이 쓴다). 명령은 Router를 같은 tx에서 바로 부른다.
  const inbox = createMailInbox({
    command: async (route: { name: string }, input: never) => {
      const given = input as {
        mail: Mail;
        origin: { machine: string; computer: string };
        skip_allowed: boolean;
        via: "link" | "folder";
        reason: CallFailReason;
      };
      if (route.name === callsMailApply.name) {
        return router.applyMail(tx, {
          mail: given.mail,
          origin: given.origin,
          skipAllowed: given.skip_allowed,
          via: given.via,
        });
      }
      assert.equal(route.name, callsMailRefuse.name);
      const refused = router.refuseMail(tx, given);
      return refused.ok ? ok({}) : refused;
    },
    computers: () =>
      Object.entries(ROSTER).map(([name, machine]) => ({
        machine,
        device: `dev_0${machine.slice(5)}`,
        name,
        self: machine === self,
      })),
    self: () => self as Id<"mch">,
    granted: () => false,
    stepReport: (
      mail: Extract<Mail, { kind: "reply" }>,
      origin: { machine: string; computer: string },
    ) => workflows.remoteReport(mail, origin),
  } as unknown as MailEntryDeps);
  // review는 이 컴퓨터의 reviewer, build는 windows 컴퓨터의 reviewer다.
  const start = (participants: Record<string, Participant>) => {
    const id = tx.newId("wfi");
    const steps = [
      {
        name: "build",
        by: "builder",
        with: null,
        prompt: "Build it.",
        in: "",
        out: "",
        next: ["review"],
      },
      {
        name: "review",
        by: "lead",
        with: null,
        prompt: "Review it.",
        in: "",
        out: "",
        next: ["end"],
      },
      // windows에 넘기려 하면 글이 mail 상한을 넘는 step.
      {
        name: "huge",
        by: "builder",
        with: null,
        prompt: "x".repeat(70 * 1024),
        in: "",
        out: "",
        next: ["end"],
      },
    ];
    const created = commands.create.handle(
      tx,
      MACHINE,
      {
        id,
        project: PROJECT,
        workflow: "ship",
        input: "go",
        participants,
        steps,
        started_by: { kind: "user" },
        handoff: planHandoff({
          instance: { id, project: PROJECT, participants, steps },
          step: "build",
          cause: "start",
          session: null,
          received: "go",
          sameSession: () => null,
          remote,
        }),
      },
      {},
    );
    assert.ok(created.ok, JSON.stringify(created));
    return { id, handed: created.value.handed };
  };
  const lines = (id: string) => read(id).lines;
  const count = (table: string) =>
    Number(db.prepare(`select count(*) as n from ${table}`).get()?.["n"]);
  const call = (id: string) =>
    db
      .prepare(
        "select state, fail_reason, delivery, receiver_session from agent_calls where call = ?",
      )
      .get(id);
  // 사람이나 이 기계의 agent가 여는 session.
  const openSession = (agent: string, workspace: Workspace | null = null) => {
    const opened = createSessionDirectory({
      projects,
      apps,
      agents,
      names: createWorkspaceNameRules({ projects, apps, agents }),
      publish: () => {},
      sql: () => sql,
    }).open(tx, { agent, workspace }, { kind: "human" }, null);
    assert.ok(opened.ok);
    return opened.value.session;
  };
  return {
    self,
    db,
    sql,
    tx,
    router,
    delivered,
    count,
    call,
    openSession,
    workflows,
    declarations,
    commands,
    inbox,
    start,
    lines,
    read,
  };
}

type Machine = Awaited<ReturnType<typeof machine>>;

function send(
  from: Machine,
  session: string,
  peer: string,
  address: RemoteAddress,
  dedup: string,
  reply: CallReply = "result",
) {
  const sent = from.router.sendRemote(from.tx, {
    session,
    dedup,
    self: from.self,
    peer: { machine: peer, computer: "peer" },
    address,
    reply,
    body: textBlocks("review the branch"),
    unattended: false,
  });
  assert.ok(sent.ok, JSON.stringify(sent));
  return sent.value.call;
}

// from의 outbox에서 to로 가는 mail을 모두 to에 적용하고 from에 ack를 적는다.
function carry(from: Machine, to: Machine, skipAllowed = false) {
  const mails = pendingMails(from.sql, to.self as never);
  for (const mail of mails) {
    const applied = to.router.applyMail(to.tx, {
      mail,
      origin: { machine: from.self, computer: "from" },
      skipAllowed,
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

// mail 입구(remote/mail-entry.ts의 applyFrom)처럼 건넨다: workflow step의 report는 workflows가, 그 밖은 Router가 받고, 적용하지
// 못한 mail은 본 것으로 적고(call이면 실패 mail을 낸다) ack한다.
async function deliver(
  from: Machine,
  to: Machine,
  mails = pendingMails(from.sql, to.self as never),
) {
  const results: Result<MailApplied>[] = [];
  for (const mail of mails) {
    const applied = await to.inbox.apply({
      mail,
      origin: from.self as Id<"mch">,
      via: "link",
    });
    results.push(applied);
    assert.ok(
      from.router.mailSent(from.tx, {
        mail: mail.id,
        result: {
          kind: "acked",
          applied: applied.ok
            ? applied.value
            : { delivery: null, reason: null, session: null },
        },
      }).ok,
    );
  }
  return results;
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

// 셋째 기계가 다른 두 기계 사이의 call에 쓴 mail. id 모양은 schema가 검사한다.
function forged(
  kind: "reply" | "cancel" | "state",
  call: string,
  from: string,
  to: string,
  id: string,
): Mail {
  const common = {
    id: `mal_0${id.padStart(25, "0")}`,
    call,
    from: { machine: from, agent: "lophn_home", session: null, name: "x" },
    to_machine: to,
    seq: 1,
    sent_at: "2026-11-21T00:00:00.000Z",
    expires_at: "2026-11-28T00:00:00.000Z",
  };
  return kind === "reply"
    ? {
        kind,
        ...common,
        body: textBlocks("not yours"),
        outcome: { state: "done", reason: null },
        unattended: false,
      }
    : kind === "cancel"
      ? { kind, ...common }
      : { kind, ...common, delivery: "held", session: null };
}

function applyFrom(to: Machine, mail: Mail, origin: string) {
  return to.router.applyMail(to.tx, {
    mail,
    origin: { machine: origin, computer: "c" },
    skipAllowed: false,
    via: "link",
  });
}

test("셋째 기계의 reply·cancel·state는 다른 두 기계 사이의 call을 바꾸지 못하고, 보낸 기계나 받는 기계가 틀린 mail은 forbidden이다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  const call = send(
    a,
    sender,
    B,
    { agent: "reviewer", workspace: { home: true } },
    "t1",
    "conversation",
  );
  carry(a, b);
  const before = { a: { ...a.call(call) }, b: { ...b.call(call) } };
  let n = 0;
  for (const kind of ["reply", "cancel", "state"] as const) {
    assert.ok(applyFrom(b, forged(kind, call, C, B, String(++n)), C).ok);
    assert.ok(applyFrom(a, forged(kind, call, C, A, String(++n)), C).ok);
  }
  assert.deepStrictEqual({ ...a.call(call) }, before.a);
  assert.deepStrictEqual({ ...b.call(call) }, before.b);
  assert.equal(b.delivered.length, 1);
  assert.equal(a.delivered.length, 0);

  const claimed = applyFrom(b, forged("cancel", call, C, B, "90"), A);
  assert.ok(!claimed.ok && claimed.error.code === "forbidden");
  const elsewhere = applyFrom(b, forged("cancel", call, A, C, "91"), A);
  assert.ok(!elsewhere.ok && elsewhere.error.code === "forbidden");
});

test("mail이 연 session과 private workspace의 session은 다른 컴퓨터로 보내지 못하고 outbox 줄도 call 행도 쓰지 않는다", async () => {
  const a = await machine(A);
  const b = await machine(B, {
    ...DEFAULT_CALL_POLICY,
    private: [{ kind: "project", id: PROJECT }],
  });
  send(
    a,
    a.openSession("lophn_home"),
    B,
    {
      agent: "reviewer",
      workspace: { home: true },
    },
    "t1",
  );
  carry(a, b);
  const opened = b.delivered[0]!.session;
  const secret = b.openSession(REVIEWER, { kind: "project", id: PROJECT });
  const rows = b.count("agent_calls");
  for (const session of [opened, secret]) {
    const sent = b.router.sendRemote(b.tx, {
      session,
      dedup: session,
      self: B,
      peer: { machine: A, computer: "a" },
      address: { agent: "reviewer", workspace: { home: true } },
      reply: "none",
      body: textBlocks("pass it on"),
      unattended: false,
    });
    assert.ok(!sent.ok && sent.error.code === "forbidden");
  }
  assert.equal(b.count("mail_outbox"), 0);
  assert.equal(b.count("agent_calls"), rows);
});

test("mail이 연 session은 허락이 없으면 묻는 session이고 허락이 있으면 agent의 skip을 따른다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  const to = { agent: "skipper", workspace: { home: true as const } };
  send(a, sender, B, to, "t1");
  carry(a, b, false);
  send(a, sender, B, to, "t2");
  carry(a, b, true);
  assert.deepStrictEqual(
    b.db
      .prepare("select skip from sessions order by created_seq")
      .all()
      .map((row) => row["skip"]),
    [0, 1],
  );
});

test("mail 본문은 글 block만, byte 상한과 block 수 상한 안에서 받는다", async () => {
  const a = await machine(A);
  send(
    a,
    a.openSession("lophn_home"),
    B,
    {
      agent: "reviewer",
      workspace: { home: true },
    },
    "t1",
  );
  const [mail] = pendingMails(a.sql, B as never);
  assert.ok(mail?.kind === "call");
  const withBody = (body: unknown) =>
    mailSchema.safeParse({ ...mail, body }).success;
  assert.ok(withBody(textBlocks("ok")));
  assert.ok(
    !withBody([{ type: "image", mimeType: "image/png", blob: "a".repeat(64) }]),
  );
  assert.ok(!withBody(textBlocks("a".repeat(64 * 1024 + 1))));
  assert.ok(!withBody(Array.from({ length: 65 }, () => textBlocks("a")[0])));
});

test("drain이 call mail을 읽은 뒤 취소해도 cancel mail이 가서 받는 기계가 call을 끝낸다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  const call = send(
    a,
    sender,
    B,
    {
      agent: "reviewer",
      workspace: { home: true },
    },
    "t1",
  );
  const [read] = pendingMails(a.sql, B as never);
  assert.ok(read !== undefined);
  const cancelled = a.router.cancel(a.tx, { kind: "human" }, { call });
  assert.ok(cancelled.ok && cancelled.value.state === "cancelled");
  assert.deepStrictEqual(
    pendingMails(a.sql, B as never).map((mail) => mail.kind),
    ["cancel"],
  );
  // 끝난 행은 배달 중인 상태를 남기지 않는다.
  assert.equal(a.call(call)?.["delivery"], null);
  assert.ok(applyFrom(b, read, A).ok);
  carry(a, b);
  assert.equal(b.call(call)?.["state"], "cancelled");
});

test("폴더 길로 cancel이 call보다 먼저 닿으면 그 call은 돌지 않고, 셋째 기계의 cancel은 call을 막지 못한다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  const to = { agent: "reviewer", workspace: { home: true as const } };
  const call = send(a, sender, B, to, "t1");
  const [first] = pendingMails(a.sql, B as never);
  assert.ok(first !== undefined);
  assert.ok(a.router.cancel(a.tx, { kind: "human" }, { call }).ok);
  const [cancel] = pendingMails(a.sql, B as never);
  assert.ok(cancel?.kind === "cancel");
  assert.ok(applyFrom(b, cancel, A).ok);
  const late = applyFrom(b, first, A);
  assert.deepStrictEqual(late.ok && late.value, {
    delivery: "failed",
    reason: "closed",
    session: null,
  });
  assert.equal(b.count("sessions"), 0);
  assert.equal(b.delivered.length, 0);

  const next = send(a, sender, B, to, "t2");
  const [mail] = pendingMails(a.sql, B as never).filter(
    (one) => one.call === next,
  );
  assert.ok(mail !== undefined);
  assert.ok(applyFrom(b, forged("cancel", next, C, B, "1"), C).ok);
  const ran = applyFrom(b, mail, A);
  assert.ok(ran.ok && ran.value.delivery === "running");
  assert.equal(b.delivered.length, 1);
});

// 받는 turn이 call을 가져간 뒤 끝나지 못한 것을 흉내 낸다: 받은 message와 도는 turn을 쓰고, 재시작처럼 turn을 interrupted로 닫는다.
// step이면 받은 message가 다른 컴퓨터에서 온 step 입력(보낸 쪽 program, call id, 답 칸 없음)이다.
function interruptAfterTake(
  m: Machine,
  session: string,
  call: string,
  step?: { instance: string; name: string },
) {
  const n = m.count("messages") + 1;
  const message = `msg_0${String(n).padStart(25, "0")}`;
  if (step === undefined) {
    m.db
      .prepare(
        `insert into messages (id, session, from_kind, from_ref, call, reply, body, created_seq, created_at, state_seq)
       values (?, ?, 'agent', 'x', ?, 'result', ?, ?, 't', ?)`,
      )
      .run(message, session, call, "a".repeat(64), 1000 + n, 1000 + n);
  } else {
    m.db
      .prepare(
        `insert into messages (id, session, from_kind, call, step_instance, step_name, body, created_seq, created_at, state_seq)
       values (?, ?, 'program', ?, ?, ?, ?, ?, 't', ?)`,
      )
      .run(
        message,
        session,
        call,
        step.instance,
        step.name,
        "a".repeat(64),
        1000 + n,
        1000 + n,
      );
  }
  m.db
    .prepare(
      `insert into turns (id, session, input_message, state, basis, started_at, limits, mode, state_seq)
       values (?, ?, ?, 'running', 'b', 't', '{}', 'attended', 1)`,
    )
    .run(`trn_0${String(n).padStart(25, "0")}`, session, message);
  const signals = {
    consumed: (tx: Tx, id: Id<"cal">) => m.router.markConsumed(tx, id),
    abandoned: (tx: Tx, input: Parameters<CallSignals["abandoned"]>[1]) =>
      m.router.abandoned(tx, input),
  };
  assert.ok(signals.consumed(m.tx, call as Id<"cal">).ok);
  const done = interruptRunningTurns(m.tx, undefined, "restarted", undefined, {
    signals,
    notify: true,
  });
  assert.ok(done.ok);
}

test("다른 컴퓨터에서 받은 result call을 가져간 turn이 재시작으로 끝나면 실패 mail이 가고 보낸 기계의 행이 failed로 닫혀 보낸 session이 알림을 받는다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  const call = send(
    a,
    sender,
    B,
    {
      agent: "reviewer",
      workspace: { home: true },
    },
    "t1",
  );
  carry(a, b);
  interruptAfterTake(b, b.delivered[0]!.session, call);
  assert.equal(b.call(call)?.["fail_reason"], "lophn_restarted");
  const [failure] = carry(b, a);
  assert.deepStrictEqual(failure?.kind === "reply" && failure.outcome, {
    state: "failed",
    reason: "lophn_restarted",
  });
  assert.deepStrictEqual(
    { ...a.call(call) },
    {
      state: "failed",
      fail_reason: "lophn_restarted",
      delivery: null,
      receiver_session: null,
    },
  );
  assert.equal(a.delivered.at(-1)?.session, sender);
  assert.equal(a.delivered.at(-1)?.input.outcome?.reason, "lophn_restarted");
  // 가져가 일하던 call이라 "가져가기 전에" 글이 아니다.
  assert.equal(
    blocksText(a.delivered.at(-1)!.input.body),
    TAKEN_RESTART_TEXTS.remote,
  );
});

test("한 컴퓨터 안의 result call도 가져간 turn이 재시작으로 끝나면 보낸 session에 lophn_restarted로 돌아가고, 답한 call은 그대로다", async () => {
  const a = await machine(A);
  const sender = a.openSession("lophn_home");
  const receiver = a.openSession(REVIEWER);
  const local = (dedup: string) => {
    const routed = a.router.route(a.tx, {
      from: { kind: "agent", session: sender as Id<"ses"> },
      to: { session: receiver },
      reply: "result",
      body: textBlocks("review"),
      refs: [],
      reply_to: null,
      dedup,
      kind: "call",
      delivery: "next_turn",
      unattended: false,
    });
    assert.ok(routed.ok && routed.value.call !== null);
    return routed.value.call;
  };
  const open = local("t1");
  interruptAfterTake(a, receiver, open);
  assert.equal(a.call(open)?.["fail_reason"], "lophn_restarted");
  assert.equal(a.delivered.at(-1)?.session, sender);
  assert.equal(a.delivered.at(-1)?.input.outcome?.reason, "lophn_restarted");
  assert.equal(
    blocksText(a.delivered.at(-1)!.input.body),
    TAKEN_RESTART_TEXTS.local,
  );

  const answered = local("t2");
  assert.ok(
    a.router.reply(
      a.tx,
      { session: receiver },
      { call: answered, body: textBlocks("done"), refs: [] },
    ).ok,
  );
  const seen = a.delivered.length;
  interruptAfterTake(a, receiver, answered);
  assert.equal(a.call(answered)?.["state"], "done");
  assert.equal(a.delivered.length, seen);
});

test("받은 기계에서 답한 result call은 그 turn이 재시작으로 끝나도 실패 mail을 내지 않는다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const sender = a.openSession("lophn_home");
  const call = send(
    a,
    sender,
    B,
    {
      agent: "reviewer",
      workspace: { home: true },
    },
    "t1",
  );
  carry(a, b);
  const receiver = b.delivered[0]!.session;
  assert.ok(
    b.router.reply(
      b.tx,
      { session: receiver },
      { call, body: textBlocks("done"), refs: [] },
    ).ok,
  );
  interruptAfterTake(b, receiver, call);
  const mails = carry(b, a);
  assert.deepStrictEqual(
    mails.map((mail) => mail.kind === "reply" && mail.outcome?.state),
    ["done"],
  );
  assert.equal(a.call(call)?.["state"], "done");
  assert.equal(a.call(call)?.["delivery"], null);
});

test("이미 있는 call id로 온 call mail은 session을 열지 않고 failed(not_found)로 답한다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const c = await machine(C);
  const call = send(
    a,
    a.openSession("lophn_home"),
    B,
    {
      agent: "reviewer",
      workspace: { home: true },
    },
    "t1",
  );
  carry(a, b);
  send(
    c,
    c.openSession("lophn_home"),
    B,
    {
      agent: "reviewer",
      workspace: { home: true },
    },
    "t2",
  );
  const [mail] = pendingMails(c.sql, B as never);
  assert.ok(mail !== undefined);
  const reused = applyFrom(b, { ...mail, call }, C);
  assert.deepStrictEqual(reused.ok && reused.value, {
    delivery: "failed",
    reason: "not_found",
    session: null,
  });
  assert.equal(b.count("sessions"), 1);
});

// workflow 참가자: build는 windows 컴퓨터의 reviewer, review는 이 컴퓨터의 reviewer다.
const REMOTE_BUILD: Record<string, Participant> = {
  builder: { agent: "reviewer", workspace: { home: true }, on: "windows" },
  lead: { agent: "reviewer", workspace: { home: true } },
};

const linesOf = (m: Machine, id: string, kind: string) =>
  m.lines(id).filter((line) => line.kind === kind);

test("다른 컴퓨터로 넘긴 step은 그 컴퓨터의 step 입력이 되고, 받은 session의 report만 시작한 컴퓨터에서 한 번 적용되어 다음 step을 넘긴다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const c = await machine(C);
  const { id, handed } = a.start(REMOTE_BUILD);
  assert.ok(handed?.outcome === "handed" && handed.receiver === null);
  await deliver(a, b);
  const [got] = b.delivered;
  assert.equal(got?.input.kind, "step");
  assert.deepStrictEqual(got.input.step, { instance: id, step: "build" });
  assert.match(blocksText(got.input.body), /workflow on the computer laptop/);
  assert.equal(a.read(id).remote_steps[0]?.delivery, "running");

  // 그 step을 받지 않은 session의 report는 이 컴퓨터의 instance를 찾다 없다.
  const other = b.openSession("lophn_home");
  const stranger = await b.workflows.report(
    { instance: id, step: "build", text: "done" },
    { kind: "agent", session: other as Id<"ses"> },
  );
  assert.ok(!stranger.ok && stranger.error.code === "not_found");
  assert.equal(pendingMails(b.sql, A as never).length, 0);

  const by = { kind: "agent", session: got.session as Id<"ses"> } as const;
  const call = got.input.call!;
  const notMine = b.router.reportStep(b.tx, {
    call,
    session: other,
    text: "done",
    next: "review",
    choice: "new",
    unattended: true,
  });
  assert.ok(!notMine.ok && notMine.error.code === "not_found");
  // 진행 글은 call을 끝내지 않는다. 같은 mail이 두 번 와도 줄은 하나다.
  const progress = await b.workflows.report(
    { instance: id, step: "build", text: "halfway" },
    by,
  );
  assert.ok(progress.ok);
  const halfway = pendingMails(b.sql, A as never);
  await deliver(b, a, halfway);
  await deliver(b, a, halfway);
  assert.equal(linesOf(a, id, "report").length, 1);
  const reported = await b.workflows.report(
    { instance: id, step: "build", text: "built", next: "review" },
    by,
  );
  assert.ok(reported.ok && reported.value.line === null);
  const again = await b.workflows.report(
    { instance: id, step: "build", text: "again", next: "review" },
    by,
  );
  assert.ok(!again.ok && again.error.code === "conflict");

  const mails = pendingMails(b.sql, A as never);
  assert.equal(mails.length, 1);
  // 셋째 컴퓨터가 같은 report를 흉내 내도 아무것도 바뀌지 않는다.
  const forged = {
    ...mails[0]!,
    id: `mal_0${"9".repeat(25)}`,
    from: { ...mails[0]!.from, machine: C },
  };
  await deliver(c, a, [forged]);
  assert.equal(linesOf(a, id, "report").length, 1);

  const [first] = await deliver(b, a, mails);
  assert.ok(first?.ok, JSON.stringify(first));
  await deliver(b, a, mails);
  const reports = linesOf(a, id, "report");
  assert.equal(reports.length, 2);
  assert.deepStrictEqual(reports[1]!.by, {
    kind: "remote",
    machine: B,
    computer: "windows",
    name: mails[0]!.from.name,
  });
  // 다음 step(review)은 이 컴퓨터의 session으로 넘어갔다.
  const handedLines = linesOf(a, id, "handed");
  assert.equal(handedLines.length, 2);
  assert.ok(
    handedLines[1]?.kind === "handed" &&
      handedLines[1].step === "review" &&
      handedLines[1].receiver !== null,
  );
  assert.equal(a.read(id).remote_steps[0]?.state, "done");
});

test("다른 컴퓨터로 넘긴 step이 report 없이 끝나면(그 컴퓨터에서 취소, call 답, 이 컴퓨터에서 취소) 시작한 컴퓨터에 읽을 수 있는 줄이 남는다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const ending = async (end: (call: string, session: string) => void) => {
    const { id } = a.start(REMOTE_BUILD);
    await deliver(a, b);
    const got = b.delivered.at(-1)!;
    end(got.input.call!, got.session);
    await deliver(b, a);
    const lines = linesOf(a, id, "not_handed");
    assert.equal(lines.length, 1);
    return lines[0]?.kind === "not_handed" ? lines[0].message : "";
  };
  // 그 컴퓨터의 사람이 받은 step call을 취소했다.
  assert.match(
    await ending((call) => {
      assert.ok(b.router.cancel(b.tx, { kind: "human" }, { call }).ok);
    }),
    /closed on windows without a report/,
  );
  // 그 컴퓨터의 agent가 workflow report 대신 call 답을 했다.
  assert.match(
    await ending((call, session) => {
      const replied = b.router.reply(
        b.tx,
        { session: session as Id<"ses"> },
        { call: call as Id<"cal">, body: textBlocks("done"), refs: [] },
      );
      assert.ok(replied.ok, JSON.stringify(replied));
    }),
    /closed on windows without a report/,
  );
  // 이 컴퓨터의 사람이 그 step call을 id로 취소했다.
  const { id } = a.start(REMOTE_BUILD);
  const [sent] = a.read(id).remote_steps;
  assert.ok(a.router.cancel(a.tx, { kind: "human" }, { call: sent!.call }).ok);
  const cancelled = linesOf(a, id, "not_handed");
  assert.ok(
    cancelled.length === 1 &&
      cancelled[0]?.kind === "not_handed" &&
      /cancelled on this computer/.test(cancelled[0].message),
  );
});

test("다른 컴퓨터가 가져간 step의 turn이 report 없이 끝나면 그 turn마다 진행 줄 mail 하나가 가고 step은 열려 있으며, report로 닫힌 step은 mail이 없다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const { id } = a.start(REMOTE_BUILD);
  await deliver(a, b);
  const got = b.delivered.at(-1)!;
  const call = got.input.call!;
  interruptAfterTake(b, got.session, call, { instance: id, name: "build" });
  // 같은 turn을 다시 닫는 길(켤 때 정산이 또 돈다)은 둘째 mail을 내지 않는다.
  assert.ok(
    interruptRunningTurns(b.tx, undefined, "restarted", undefined, {
      signals: {
        consumed: (tx, one) => b.router.markConsumed(tx, one),
        abandoned: (tx, input) => b.router.abandoned(tx, input),
      },
      notify: true,
    }).ok,
  );
  const mails = pendingMails(b.sql, A as never);
  assert.equal(mails.length, 1);
  const [mail] = mails;
  assert.ok(mail?.kind === "reply");
  assert.deepStrictEqual(
    { body: mail.body, outcome: mail.outcome, report: mail.report },
    {
      body: null,
      outcome: null,
      report: { next: null, session: "new", ended: "restarted" },
    },
  );
  assert.equal(b.call(call)?.["state"], "accepted");
  await deliver(b, a);
  const [line] = linesOf(a, id, "report");
  assert.ok(line?.kind === "report");
  assert.deepStrictEqual(line.by, {
    kind: "remote_lophn",
    machine: B,
    computer: "windows",
  });
  assert.match(
    line.text,
    /on windows was cut off when lophn on windows restarted/,
  );
  assert.equal(a.read(id).remote_steps[0]?.state, "accepted");
  // 사람이 그 session을 다시 밀어 낸 report는 그대로 닿아 다음 step을 넘긴다.
  const reported = await b.workflows.report(
    { instance: id, step: "build", text: "built", next: "review" },
    { kind: "agent", session: got.session as Id<"ses"> },
  );
  assert.ok(reported.ok, JSON.stringify(reported));
  await deliver(b, a);
  assert.equal(a.read(id).remote_steps[0]?.state, "done");
  assert.equal(linesOf(a, id, "handed").length, 2);

  // report(next)로 닫힌 step은 그 뒤 turn이 끊겨도 mail이 없다.
  const second = a.start(REMOTE_BUILD);
  await deliver(a, b);
  const took = b.delivered.at(-1)!;
  const closed = await b.workflows.report(
    { instance: second.id, step: "build", text: "built", next: "review" },
    { kind: "agent", session: took.session as Id<"ses"> },
  );
  assert.ok(closed.ok);
  await deliver(b, a);
  interruptAfterTake(b, took.session, took.input.call!, {
    instance: second.id,
    name: "build",
  });
  assert.equal(pendingMails(b.sql, A as never).length, 0);
});

test("다른 컴퓨터의 report는 다음 step을 넘기지 못해도 report 줄과 not_handed 줄로 남는다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const { id } = a.start(REMOTE_BUILD);
  await deliver(a, b);
  const got = b.delivered[0]!;
  const reported = await b.workflows.report(
    { instance: id, step: "build", text: "built", next: "huge" },
    { kind: "agent", session: got.session as Id<"ses"> },
  );
  assert.ok(reported.ok);
  const [applied] = await deliver(b, a);
  assert.ok(applied?.ok, JSON.stringify(applied));
  assert.equal(linesOf(a, id, "report").length, 1);
  const notHanded = linesOf(a, id, "not_handed");
  assert.ok(
    notHanded.length === 1 &&
      notHanded[0]?.kind === "not_handed" &&
      notHanded[0].step === "huge" &&
      /cannot go to another computer/.test(notHanded[0].message),
  );
  assert.equal(a.read(id).remote_steps[0]?.state, "done");
});

test("명단에서 빠진 컴퓨터로 보낸 call과 step은 만료를 기다리지 않고 곧바로 읽을 수 있는 실패로 닫힌다", async () => {
  const a = await machine(A);
  const sender = a.openSession("lophn_home");
  const to = { agent: "reviewer", workspace: { home: true as const } };
  // 아직 닿지 않음(pending), 받았는지 모름(unknown), 대기 목록(held).
  const pending = send(a, sender, B, to, "t1");
  const unknown = send(a, sender, B, to, "t2");
  const held = send(a, sender, B, to, "t3");
  const mails = pendingMails(a.sql, B as never);
  const mailOf = (call: string) => mails.find((mail) => mail.call === call)!;
  assert.ok(
    a.router.mailSent(a.tx, {
      mail: mailOf(unknown).id,
      result: { kind: "unknown" },
    }).ok,
  );
  assert.ok(
    a.router.mailSent(a.tx, {
      mail: mailOf(held).id,
      result: {
        kind: "acked",
        applied: { delivery: "held", reason: null, session: null },
      },
    }).ok,
  );
  const { id } = a.start(REMOTE_BUILD);
  // 명단에 남은 컴퓨터로 보낸 call은 그대로다.
  const kept = send(a, sender, C, to, "t4");

  const swept = a.router.sweepMail(a.tx, [B]);
  assert.ok(swept.ok, JSON.stringify(swept));
  for (const call of [pending, unknown, held]) {
    assert.equal(a.call(call)?.["state"], "failed");
  }
  assert.equal(a.call(kept)?.["state"], "accepted");
  assert.equal(pendingMails(a.sql, B as never).length, 0);
  const told = a.delivered.filter((each) => each.session === sender);
  assert.equal(told.length, 3);
  for (const each of told) {
    assert.equal(blocksText(each.input.body), LEFT_ROSTER_TEXT);
  }
  const notHanded = linesOf(a, id, "not_handed");
  assert.ok(
    notHanded.length === 1 &&
      notHanded[0]?.kind === "not_handed" &&
      /no longer one of the person's computers/.test(notHanded[0].message),
  );
});

// 사람이 쓴 선언 글을 file 읽기가 낸 그대로 시작한다: 참가자의 on이 선언에서 instance와 목록까지 간다.
const DECLARATION = (on: string) => `kind: agent
participants:
  here: { agent: reviewer, workspace: { home: true } }
  there: { agent: reviewer, workspace: { home: true }, on: ${on} }
steps:
  one:
    by: here
    prompt: Start it.
    next: [two]
  two:
    by: there
    prompt: Finish it there.
    next: [end]
`;

test("선언 file의 on이 instance와 목록까지 가서 다음 step이 그 컴퓨터로 넘어가고, 모르는 컴퓨터는 unknown_computer다", async () => {
  const a = await machine(A);
  a.declarations.set("ship", DECLARATION("windows"));
  const listed = await a.workflows.list({ project: "shop" }, null);
  assert.ok(listed.ok);
  assert.deepStrictEqual(listed.value.workflows[0]?.participants?.["there"], {
    agent: "reviewer",
    workspace: { home: true },
    on: "windows",
  });
  const started = await a.workflows.start(
    { workflow: "shop/ship", text: "go" },
    { kind: "user" },
  );
  assert.ok(started.ok, JSON.stringify(started));
  const id = started.value.instance.id;
  assert.equal(
    (started.value.instance.participants["there"] as { on?: string }).on,
    "windows",
  );
  const here = a.delivered.at(-1)!;
  assert.equal(here.input.step?.step, "one");
  const reported = await a.workflows.report(
    { instance: id, step: "one", text: "half done", next: "two" },
    { kind: "agent", session: here.session as Id<"ses"> },
  );
  assert.ok(reported.ok, JSON.stringify(reported));
  assert.ok(
    reported.value.handed?.outcome === "handed" &&
      reported.value.handed.receiver === null,
    JSON.stringify(reported.value.handed),
  );
  const [step] = a.read(id).remote_steps;
  assert.equal(step?.step, "two");
  assert.equal(step?.machine, B);
  const [mail] = pendingMails(a.sql, B as never);
  assert.ok(mail?.kind === "call" && mail.step?.name === "two");

  // 사람이 쓴 이름이 명단에 없으면 그 이유로 남는다.
  a.declarations.set("ship", DECLARATION("nowhere"));
  const again = await a.workflows.start(
    { workflow: "shop/ship", text: "go", step: "two" },
    { kind: "user" },
  );
  assert.ok(again.ok, JSON.stringify(again));
  assert.ok(
    again.value.handed?.outcome === "not_handed" &&
      again.value.handed.reason === "unknown_computer",
    JSON.stringify(again.value.handed),
  );
});

test("사람 참가자의 on은 틀린 선언이다", () => {
  const parsed = parseDeclaration({
    name: "ship",
    declaration: `kind: agent
participants:
  me: { kind: human, on: windows }
steps:
  one:
    by: me
    prompt: Do it.
`,
    flow: false,
    artifacts: { static: false, instance: false },
  });
  assert.ok(!parsed.ok && parsed.problem.reason === "invalid_declaration");
});

test("늦게 닿은 step은 대기 목록에 서고, 그 컴퓨터의 사람이 건너뛰면 시작한 컴퓨터에 읽을 수 있는 줄이 남는다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const { id } = a.start(REMOTE_BUILD);
  const [mail] = pendingMails(a.sql, B as never);
  assert.ok(mail !== undefined);
  await deliver(a, b, [{ ...mail, sent_at: "2026-11-20T23:00:00.000Z" }]);
  assert.equal(b.delivered.length, 0);
  assert.equal(a.read(id).remote_steps[0]?.delivery, "held");
  const skipped = b.router.decideHold(b.tx, {
    origin: A,
    mail: mail.id,
    decision: "skip",
    skipAllowed: false,
  });
  assert.ok(skipped.ok);
  await deliver(b, a);
  const notHanded = linesOf(a, id, "not_handed");
  assert.equal(notHanded.length, 1);
  assert.ok(
    notHanded[0]?.kind === "not_handed" &&
      notHanded[0].reason === "remote_failed" &&
      /chose not to run this step/.test(notHanded[0].message),
  );
  assert.equal(a.read(id).remote_steps[0]?.fail_reason, "skipped");
});

test("private workspace는 다른 컴퓨터로 step을 넘기지도 받지도 않는다", async () => {
  const shut = {
    ...DEFAULT_CALL_POLICY,
    private: [{ kind: "project" as const, id: PROJECT }],
  };
  const sender = await machine(A, shut);
  const { id: kept, handed } = sender.start(REMOTE_BUILD);
  assert.ok(handed?.outcome === "not_handed" && handed.reason === "unresolved");
  assert.equal(sender.count("mail_outbox"), 0);
  assert.equal(sender.count("agent_calls"), 0);
  assert.equal(linesOf(sender, kept, "handed").length, 0);

  const a = await machine(A);
  const b = await machine(B, shut);
  const { id } = a.start({
    ...REMOTE_BUILD,
    builder: { agent: "reviewer", on: "windows" },
  });
  await deliver(a, b);
  assert.equal(b.delivered.length, 0);
  assert.equal(b.count("sessions"), 0);
  await deliver(b, a);
  const notHanded = linesOf(a, id, "not_handed");
  assert.equal(notHanded.length, 1);
  assert.ok(
    notHanded[0]?.kind === "not_handed" &&
      notHanded[0].reason === "remote_failed",
  );
});

test("멈춘 instance는 아직 가져가지 않은 다른 컴퓨터의 step을 거둬 그 컴퓨터에서 돌지 않는다", async () => {
  const a = await machine(A);
  const b = await machine(B);
  const { id } = a.start(REMOTE_BUILD);
  // drain이 call mail을 이미 읽었다.
  const read = pendingMails(a.sql, B as never);
  const stopped = a.commands.apply.handle(
    a.tx,
    MACHINE,
    {
      instance: id,
      change: { kind: "stop" },
      by: { kind: "user" },
      handoff: null,
    },
    { state_seq: a.read(id).instance.state_seq },
  );
  assert.ok(stopped.ok, JSON.stringify(stopped));
  assert.deepStrictEqual(
    pendingMails(a.sql, B as never).map((mail) => mail.kind),
    ["cancel"],
  );
  const [step] = a.read(id).remote_steps;
  assert.equal(step?.state, "cancelled");
  // 거둔 step은 stopped 줄이 말한다. 따로 not_handed 줄을 남기지 않는다.
  assert.equal(linesOf(a, id, "not_handed").length, 0);
  assert.equal(step?.delivery, null);
  await deliver(a, b);
  await deliver(a, b, read);
  assert.equal(b.delivered.length, 0);
  assert.equal(b.count("sessions"), 0);
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
