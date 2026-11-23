import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createIdSource, err, type Logger, ok } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { DEFAULT_CALL_POLICY } from "../../protocol/lophn-agent/call-policy.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createRouter } from "../router/mod.ts";
import type { RoutedInput } from "../router/ports.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createWorkflowCommands } from "./commands.ts";
import { workflowLinesSchemaSteps } from "./lines-schema.ts";
import type { StepTurn, WorkflowFlows, WorkflowRemote } from "./ports.ts";
import { workflowsSchemaSteps } from "./schema.ts";
import { createWorkflowService } from "./service.ts";
import {
  appendLine,
  insertInstance,
  lastReports,
  loadInstance,
  loadLines,
  runningInstances,
} from "./store.ts";

const FLOW = "wfi_01hzzzzzzzzzzzzzzzzzzzzzza";
const AGENT = "wfi_01hzzzzzzzzzzzzzzzzzzzzzzb";
const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const AT = "2026-10-22T00:00:00.000Z";

const logger: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: () => Promise.resolve(),
};

// 켤 때 running인 flow instance를 닫는 것이 process를 다시 띄우면 바깥 효과가 두 번 난다.
// agent instance는 handed 줄이 없을 뿐 건드리지 않는다.
test("reconcile closes a running flow instance without launching again and leaves an agent instance alone", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(workflowsSchemaSteps[0]!.sql);
    const sql = createSql(db, () => true);
    const tx = {
      sql,
      now: () => AT,
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzc`,
      port: () => ({ push: () => {} }),
    } as unknown as Tx;
    const commands = createWorkflowCommands(() => {
      throw new Error("router is not used");
    });
    const ctx = { actor: "machine" } as never;
    const launched: unknown[] = [];
    const flows: WorkflowFlows = {
      launch: (start) => {
        launched.push(start);
        return Promise.resolve(ok(undefined));
      },
      stop: () => Promise.resolve(ok(undefined)),
    };
    const kinds = (id: string) => {
      const lines = loadLines(sql, id, { after: 0, limit: null });
      assert.ok(lines.ok);
      return lines.value.map((l) => l.kind);
    };
    const stateOf = (id: string) => {
      const loaded = loadInstance(sql, id);
      assert.ok(loaded.ok && loaded.value !== null);
      return loaded.value.state;
    };

    const created = commands.create.handle(
      tx,
      ctx,
      {
        id: FLOW,
        project: PRJ,
        workflow: "demo",
        input: "go",
        participants: {},
        steps: [],
        started_by: { kind: "user" },
        handoff: null,
      },
      {},
    );
    assert.ok(created.ok);
    insertInstance(sql, {
      id: AGENT,
      project: PRJ,
      workflow: "demo",
      input: "go",
      participants: { planner: { agent: "lophn" } },
      steps: [],
      current: null,
      started_by: { kind: "user" },
      created_at: AT,
    });
    appendLine(sql, AGENT, AT, {
      kind: "started",
      by: { kind: "user" },
      step: "a",
      text: "go",
    });

    const service = createWorkflowService({
      files: {} as never,
      projects: {} as never,
      turns: {} as never,
      remote: {} as never,
      logger,
      store: {
        create: (input) =>
          Promise.resolve(commands.create.handle(tx, ctx, input, {})),
        apply: (input, compare) =>
          Promise.resolve(commands.apply.handle(tx, ctx, input, compare)),
        read: (id) => {
          const instance = loadInstance(sql, id);
          const lines = loadLines(sql, id, { after: 0, limit: null });
          const reports = lastReports(sql, id);
          assert.ok(
            instance.ok && instance.value !== null && lines.ok && reports.ok,
          );
          return Promise.resolve(
            ok({
              instance: instance.value,
              lines: lines.value,
              last_reports: reports.value,
              next_cursor: null,
            } as never),
          );
        },
        running: () => Promise.resolve(runningInstances(sql)),
      },
      flows,
      ids: createIdSource({
        clock: { now: () => AT } as never,
        random: {} as never,
      }),
    });

    const agentBefore = kinds(AGENT);
    await service.reconcile();

    assert.deepStrictEqual(kinds(FLOW), [
      "started",
      "lophn_restarted",
      "ended",
    ]);
    assert.deepStrictEqual(stateOf(FLOW), "ended");
    assert.deepStrictEqual(kinds(AGENT), agentBefore);
    assert.deepStrictEqual(stateOf(AGENT), "running");
    assert.deepStrictEqual(launched, []);
  } finally {
    db.close();
  }
});

const SES_A = "ses_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"ses">;
const SES_B = "ses_01hzzzzzzzzzzzzzzzzzzzzzzb" as Id<"ses">;
const TRN_1 = "trn_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"trn">;
const lophnAtWorkspace = { agent: "lophn", workspace: null } as const;

function makeHarness(options?: {
  openCalls?: () => number;
  stepTurn?: () => StepTurn | null;
  resolveOpen?: () => boolean;
}) {
  const db = new DatabaseSync(":memory:");
  db.exec(workflowsSchemaSteps[0]!.sql);
  db.exec(workflowLinesSchemaSteps[0]!.sql);
  const sql = createSql(db, () => true);
  const delivered: { session: string; input: RoutedInput }[] = [];
  let openedCount = 0;
  let openCalls = options?.openCalls ?? (() => 0);
  let stepTurn = options?.stepTurn ?? (() => null);
  let canResolve = options?.resolveOpen ?? (() => true);
  const tx = {
    sql,
    now: () => AT,
    newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzc`,
    port: () => ({ push: () => {} }),
  } as unknown as Tx;
  const router = createRouter({
    directory: {
      find: (session) =>
        session === SES_A || session === SES_B
          ? ({
              session,
              transport: "lophn",
              agent: lophnAtWorkspace,
              accepting: true,
              open: true,
              spawned_by: null,
              opened_by_machine: null,
              runs_on: null,
            } as never)
          : null,
      resolveAddress: () =>
        canResolve()
          ? ok(lophnAtWorkspace)
          : err({ code: "not_found", message: "agent not found" }),
      archive: () => ok(false),
      membersOn: () => [],
      membersFrom: () => [],
      membersUnder: () => [],
      setWorkflowOrigin: () => {},
      openMember: () => err({ code: "forbidden", message: "not in this test" }),
      open: () => {
        openedCount += 1;
        return ok({
          session: openedCount === 1 ? SES_A : SES_B,
          transport: "lophn",
          agent: lophnAtWorkspace,
          accepting: true,
          open: true,
          spawned_by: null,
          opened_by_machine: null,
          runs_on: null,
        } as never);
      },
      app: () => null,
      accepts: () => null,
      listOpen: () => [],
      projectOfIdentity: () => null,
      identityOfProject: () => ok("pri_test"),
      appIdOf: () => err({ code: "not_found", message: "app not found" }),
    },
    store: {} as never,
    outbox: {} as never,
    seen: {} as never,
    self: () => "mch_self",
    steps: {} as never,
    announce: () => {},
    callPolicy: () => DEFAULT_CALL_POLICY,
    transport: {
      deliver: (_tx, to, input) => {
        delivered.push({ session: to.session, input });
        return ok(undefined);
      },
      cancel: () => ok(undefined),
      withdraw: () => ok(undefined),
    },
  });
  const commands = createWorkflowCommands(() => ok(router));
  const ctx = { actor: "machine" } as never;
  const remote: WorkflowRemote = {
    computer: () => err({ code: "not_found", message: "none" }),
    workspace: () => err({ code: "not_found", message: "none" }),
    isPrivate: () => false,
    receivedStep: () => Promise.resolve(ok(null)),
    report: () => Promise.resolve(ok(undefined)),
    handOf: () => ok(null),
  };
  const service = createWorkflowService({
    files: {} as never,
    projects: {} as never,
    turns: {
      stopSession: () => Promise.resolve(ok(undefined)),
      stepTurn: () => Promise.resolve(ok(stepTurn())),
      openOutgoingCalls: () => Promise.resolve(ok(openCalls())),
    },
    remote,
    logger,
    store: {
      create: (input) =>
        Promise.resolve(commands.create.handle(tx, ctx, input, {})),
      apply: (input, compare) =>
        Promise.resolve(commands.apply.handle(tx, ctx, input, compare)),
      read: (id) => {
        const instance = loadInstance(sql, id);
        const lines = loadLines(sql, id, { after: 0, limit: null });
        const reports = lastReports(sql, id);
        assert.ok(
          instance.ok && instance.value !== null && lines.ok && reports.ok,
        );
        return Promise.resolve(
          ok({
            instance: instance.value,
            lines: lines.value,
            last_reports: reports.value,
            remote_steps: [],
            as_of_seq: "1",
            next_cursor: null,
          }),
        );
      },
      running: () => Promise.resolve(runningInstances(sql)),
    },
    flows: {
      launch: () => Promise.resolve(ok(undefined)),
      stop: () => Promise.resolve(ok(undefined)),
    },
    ids: createIdSource({
      clock: { now: () => AT } as never,
      random: {} as never,
    }),
  });
  const linesOf = (id: string) => {
    const lines = loadLines(sql, id, { after: 0, limit: null });
    assert.ok(lines.ok);
    return lines.value;
  };
  return {
    db,
    sql,
    tx,
    ctx,
    commands,
    service,
    delivered,
    linesOf,
    get openedCount() {
      return openedCount;
    },
    setOpenCalls(fn: () => number) {
      openCalls = fn;
    },
    setStepTurn(fn: () => StepTurn | null) {
      stepTurn = fn;
    },
    setCanResolve(fn: () => boolean) {
      canResolve = fn;
    },
  };
}

// stall 감지: non-human step은 열린 call이 없을 때 넘김/retry당 1회만 step_stalled를 남기고,
// human step과 열린 outgoing agent_calls가 있는 경우는 건너뛴다.
test("turnEnded emits step_stalled once per attempt for non-human steps, skips human_turn and open agent_calls", async () => {
  const h = makeHarness();
  try {
    // 1) non-human step (AGENT)
    const created = h.commands.create.handle(
      h.tx,
      h.ctx,
      {
        id: AGENT,
        project: PRJ,
        workflow: "demo",
        input: "go",
        participants: { worker: { agent: "lophn" }, me: { kind: "human" } },
        steps: [
          {
            name: "work",
            by: "worker",
            with: null,
            prompt: "do work",
            in: "",
            out: "artifact",
            next: ["end"],
          },
        ],
        started_by: { kind: "user" },
        handoff: {
          step: "work",
          participant: "worker",
          human_turn: false,
          cause: "start",
          session: null,
          delivery: {
            to: { agent: "lophn", workspace: { project: PRJ } },
            body: "do work",
          },
          unresolved: null,
        },
      },
      {},
    );
    assert.ok(created.ok);

    // 2) human step (FLOW id를 다른 instance로 재사용)
    const humanCreated = h.commands.create.handle(
      h.tx,
      h.ctx,
      {
        id: FLOW,
        project: PRJ,
        workflow: "demo-human",
        input: "discuss",
        participants: { helper: { agent: "lophn" }, me: { kind: "human" } },
        steps: [
          {
            name: "chat",
            by: "me",
            with: "helper",
            prompt: "talk with user",
            in: "",
            out: "",
            next: ["end"],
          },
        ],
        started_by: { kind: "user" },
        handoff: {
          step: "chat",
          participant: "helper",
          human_turn: true,
          cause: "start",
          session: null,
          delivery: {
            to: { agent: "lophn", workspace: { project: PRJ } },
            body: "talk with user",
          },
          unresolved: null,
        },
      },
      {},
    );
    assert.ok(humanCreated.ok);

    // human step 세션의 turn이 끝나도 step_stalled를 남기지 않는다.
    await h.service.turnEnded({
      session: SES_B,
      turn: TRN_1,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    assert.deepStrictEqual(
      h.linesOf(FLOW).filter((l) => l.kind === "step_stalled"),
      [],
    );

    // 열린 outgoing agent_calls가 있으면(worker 대기 중) stall로 보지 않는다.
    h.setOpenCalls(() => 2);
    await h.service.turnEnded({
      session: SES_A,
      turn: TRN_1,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    assert.deepStrictEqual(
      h.linesOf(AGENT).filter((l) => l.kind === "step_stalled"),
      [],
    );

    // 열린 call이 0개가 된 뒤 실패로 끝나면 실패 이유와 함께 step_stalled를 남긴다.
    h.setOpenCalls(() => 0);
    await h.service.turnEnded({
      session: SES_A,
      turn: TRN_1,
      outcome: { kind: "failed", reason: "model_error" },
      error: { code: "model_error", message: "upstream timeout" },
    });
    const stalled = h.linesOf(AGENT).filter((l) => l.kind === "step_stalled");
    assert.equal(stalled.length, 1);
    assert.equal(stalled[0]!.kind, "step_stalled");
    assert.equal(stalled[0]!.session, SES_A);
    assert.equal(stalled[0]!.reason, "model_error");
    assert.equal(stalled[0]!.message, "upstream timeout");

    // 같은 넘김 시도에서 추가 turn이 끝나도(사람이 세션에 들어가 대화한 경우 등) 중복 기록하지 않는다.
    await h.service.turnEnded({
      session: SES_A,
      turn: TRN_1,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    assert.equal(
      h.linesOf(AGENT).filter((l) => l.kind === "step_stalled").length,
      1,
    );
  } finally {
    h.db.close();
  }
});

// RetryWorkflowStep: working·stopped는 conflict, blocked는 같은 session 이어가기(새 session 열지 않음),
// not_handed는 넘기기 재시도를 수행한다.
test("retry continues same session when blocked, rejects working/stopped with conflict, and re-hands not_handed", async () => {
  const h = makeHarness();
  try {
    const created = h.commands.create.handle(
      h.tx,
      h.ctx,
      {
        id: AGENT,
        project: PRJ,
        workflow: "demo",
        input: "go",
        participants: { worker: { agent: "lophn" } },
        steps: [
          {
            name: "work",
            by: "worker",
            with: null,
            prompt: "do work",
            in: "",
            out: "artifact",
            next: ["end"],
          },
        ],
        started_by: { kind: "user" },
        handoff: {
          step: "work",
          participant: "worker",
          human_turn: false,
          cause: "start",
          session: null,
          delivery: {
            to: { agent: "lophn", workspace: { project: PRJ } },
            body: "do work",
          },
          unresolved: null,
        },
      },
      {},
    );
    assert.ok(created.ok);

    // 정상 working 중(막히지 않음)에는 conflict다.
    h.setStepTurn(() => ({ turn: TRN_1, state: "running", outcome: null }));
    const workingRetry = await h.service.retry({ instance: AGENT });
    assert.ok(!workingRetry.ok);
    assert.equal(workingRetry.error.code, "conflict");

    // stall이 나면 blocked가 되어 같은 session에 이어서 하라는 입력을 넣고 retried 줄을 남긴다.
    await h.service.turnEnded({
      session: SES_A,
      turn: TRN_1,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    const retried = await h.service.retry({ instance: AGENT });
    assert.ok(retried.ok);
    assert.equal(h.openedCount, 1);
    assert.equal(h.delivered.length, 2);
    assert.equal(h.delivered[1]!.session, SES_A);
    assert.deepStrictEqual(
      h.linesOf(AGENT).map((l) => l.kind),
      ["started", "handed", "step_stalled", "retried"],
    );

    // retry 직후에는 다시 working 상태라 또 retry하면 conflict다.
    h.setStepTurn(() => ({ turn: TRN_1, state: "running", outcome: null }));
    const secondRetry = await h.service.retry({ instance: AGENT });
    assert.ok(!secondRetry.ok);
    assert.equal(secondRetry.error.code, "conflict");

    // retry 뒤 turn이 다시 report 없이 끝나면 그 retry 시도에 대해 step_stalled가 최대 1회 새로 남는다.
    await h.service.turnEnded({
      session: SES_A,
      turn: TRN_1,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    await h.service.turnEnded({
      session: SES_A,
      turn: TRN_1,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    assert.equal(
      h.linesOf(AGENT).filter((l) => l.kind === "step_stalled").length,
      2,
    );

    // stopped instance는 conflict다.
    const stopped = await h.service.stop({ instance: AGENT }, { kind: "user" });
    assert.ok(stopped.ok);
    const stoppedRetry = await h.service.retry({ instance: AGENT });
    assert.ok(!stoppedRetry.ok);
    assert.equal(stoppedRetry.error.code, "conflict");

    // not_handed로 세션이 아직 열리지 않은 instance는 retry 시 넘기기를 다시 시도한다.
    const notHandedCreated = h.commands.create.handle(
      h.tx,
      h.ctx,
      {
        id: FLOW,
        project: PRJ,
        workflow: "demo-not-handed",
        input: "start input",
        participants: { worker: { agent: "lophn" } },
        steps: [
          {
            name: "plan",
            by: "worker",
            with: null,
            prompt: "make plan",
            in: "",
            out: "",
            next: ["end"],
          },
        ],
        started_by: { kind: "user" },
        handoff: {
          step: "plan",
          participant: null,
          human_turn: false,
          cause: "start",
          session: null,
          delivery: null,
          unresolved: { reason: "unresolved", message: "agent unavailable" },
        },
      },
      {},
    );
    assert.ok(notHandedCreated.ok);
    const rehanded = await h.service.retry({ instance: FLOW });
    assert.ok(rehanded.ok);
    assert.equal(h.openedCount, 2);
    assert.deepStrictEqual(
      h.linesOf(FLOW).map((l) => l.kind),
      ["started", "not_handed", "retried", "handed"],
    );
    const handedLine = h.linesOf(FLOW).findLast((l) => l.kind === "handed");
    assert.ok(handedLine?.kind === "handed");
    assert.equal(handedLine.cause, "retry");
    assert.equal(handedLine.receiver, SES_B);
  } finally {
    h.db.close();
  }
});
