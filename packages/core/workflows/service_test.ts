import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createIdSource, err, type Logger, ok } from "../../base/mod.ts";
import {
  createKnownSecretRegistry,
  createProductRedactor,
} from "../../base/redaction/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { DEFAULT_CALL_POLICY } from "../../protocol/lophn-agent/call-policy.ts";
import { blocksText } from "../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import {
  removeWorkflowFromLayoutText,
  renameWorkflowInLayoutText,
} from "../main/daemon/wiring/workflows-files.ts";
import { createRouter } from "../router/mod.ts";
import type { RoutedInput } from "../router/ports.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createWorkflowCommands } from "./commands.ts";
import { entryOf } from "./declaration.ts";
import { WORKFLOW_INPUTS_SCHEMA_STEP } from "./inputs-schema.ts";
import { workflowLinesSchemaSteps } from "./lines-schema.ts";
import { redactJsonValues, stepBody } from "./plan.ts";
import type {
  DefinitionFile,
  StepTurn,
  WorkflowAgents,
  WorkflowFiles,
  WorkflowFlows,
  WorkflowRemote,
} from "./ports.ts";
import { deriveWorkflowStatus } from "./reads.ts";
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

// 켤 때 code_snapshot과 checkpoint가 없는 pre-Phase-4 running flow instance는 replay하지 않고
// lophn_restarted 줄을 남겨 blocked(running)로 둔다. agent instance는 handed 줄이 없을 뿐 건드리지 않는다.
test("reconcile marks pre-Phase-4 running flow instance blocked without relaunching and leaves an agent instance alone", async () => {
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

    assert.deepStrictEqual(kinds(FLOW), ["started", "lophn_restarted"]);
    assert.deepStrictEqual(stateOf(FLOW), "running");
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

// 사람이 stalled/restarted step의 session에서 직접 새 turn을 시작하면 중복 입력 없이 retried를 남겨
// working으로 복구하고, 그 turn이 다시 report 없이 끝나면 재판정한다.
test("sessionResumed clears step_stalled and lophn_restarted without injecting a duplicate prompt", async () => {
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
    assert.equal(h.delivered.length, 1);

    // 1) Esc 등으로 turn이 report 없이 끝나면 step_stalled -> blocked.
    await h.service.turnEnded({
      session: SES_A,
      outcome: { kind: "failed", reason: "no_answer" },
      error: null,
    });
    const stalledLines = h.linesOf(AGENT);
    assert.deepStrictEqual(
      stalledLines.map((l) => l.kind),
      ["started", "handed", "step_stalled"],
    );
    assert.equal(
      deriveWorkflowStatus({
        state: "running",
        current: { step: "work", human_turn: false },
        latestStatusLine: "step_stalled",
        sessions: [],
        remoteSteps: [],
      }),
      "blocked",
    );

    // 2) 사람이 session에서 직접 새 turn을 시작하면 중복 메시지를 넣지 않고 retried를 남겨 working으로 돌아간다.
    await h.service.sessionResumed(SES_A);
    await h.service.sessionResumed(SES_A); // 멱등
    assert.equal(h.delivered.length, 1);
    const resumedLines = h.linesOf(AGENT);
    assert.deepStrictEqual(
      resumedLines.map((l) => l.kind),
      ["started", "handed", "step_stalled", "retried"],
    );
    assert.equal(
      deriveWorkflowStatus({
        state: "running",
        current: { step: "work", human_turn: false },
        latestStatusLine: "retried",
        sessions: [],
        remoteSteps: [],
      }),
      "working",
    );

    // 3) 이어진 turn이 하위 call을 띄운 채 끝나면 stall로 보지 않는다.
    h.setOpenCalls(() => 1);
    await h.service.turnEnded({
      session: SES_A,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    assert.equal(
      h.linesOf(AGENT).filter((l) => l.kind === "step_stalled").length,
      1,
    );

    // 4) 열린 call 없이 다시 report 없이 끝나면 새 step_stalled가 남는다.
    h.setOpenCalls(() => 0);
    await h.service.turnEnded({
      session: SES_A,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    assert.equal(
      h.linesOf(AGENT).filter((l) => l.kind === "step_stalled").length,
      2,
    );

    // 5) lophn_restarted로 막힌 instance도 같은 session에서 새 turn이 시작되면 복구된다.
    const restarted = h.commands.create.handle(
      h.tx,
      h.ctx,
      {
        id: FLOW,
        project: PRJ,
        workflow: "demo-restarted",
        input: "go",
        participants: { worker: { agent: "lophn" } },
        steps: [
          {
            name: "work",
            by: "worker",
            with: null,
            prompt: "do work",
            in: "",
            out: "",
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
    assert.ok(restarted.ok);
    const deliveredBeforeRestart = h.delivered.length;
    appendLine(h.sql, FLOW, AT, {
      kind: "lophn_restarted",
      by: { kind: "lophn" },
      step: "work",
      receiver: SES_B,
    });
    await h.service.sessionResumed(SES_B);
    assert.equal(h.delivered.length, deliveredBeforeRestart);
    assert.deepStrictEqual(
      h.linesOf(FLOW).map((l) => l.kind),
      ["started", "handed", "lophn_restarted", "retried"],
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

// Phase 3 Core: declaration invalid_inputs, ListWorkflows callable_agents, StartWorkflow validation
// (missing required, when-hidden skipped, callable agent check), YAML Inputs: injection, and
// recursive fail-closed redaction of inputs before persisting / launching flow.
test("declaration reports invalid_inputs without crashing and ListWorkflows returns inputs, outputs, and callable_agents", async () => {
  const validYaml = [
    "kind: agent",
    "inputs:",
    "  env:",
    "    type: select",
    "    options: [staging, prod]",
    "    default: staging",
    "outputs:",
    "  report:",
    "    type: path",
    "participants:",
    "  worker: { agent: lophn }",
    "steps:",
    "  run:",
    "    by: worker",
    "    prompt: do work",
  ].join("\n");
  const badSelectYaml = [
    "kind: agent",
    "inputs:",
    "  env:",
    "    type: select",
    "participants:",
    "  worker: { agent: lophn }",
    "steps:",
    "  run:",
    "    by: worker",
    "    prompt: do work",
  ].join("\n");
  const badTypeYaml = [
    "kind: agent",
    "inputs:",
    "  env:",
    "    type: not_a_type",
    "participants:",
    "  worker: { agent: lophn }",
    "steps:",
    "  run:",
    "    by: worker",
    "    prompt: do work",
  ].join("\n");

  const defFiles: DefinitionFile[] = [
    {
      name: "good",
      declaration: validYaml,
      flow: false,
      artifacts: { static: false, instance: false },
    },
    {
      name: "bad-select",
      declaration: badSelectYaml,
      flow: false,
      artifacts: { static: false, instance: false },
    },
    {
      name: "bad-type",
      declaration: badTypeYaml,
      flow: false,
      artifacts: { static: false, instance: false },
    },
  ];
  const directBad = entryOf(PRJ as Id<"prj">, "demo/bad-select", defFiles[1]!);
  assert.equal(directBad.state, "invalid");
  assert.equal(directBad.startable, false);
  assert.equal(directBad.problem?.reason, "invalid_inputs");
  assert.match(directBad.problem?.message ?? "", /inputs\.env/);

  const files: WorkflowFiles = {
    list: () => Promise.resolve(ok(defFiles)),
  };
  const agents: WorkflowAgents = {
    listCallable: () =>
      Promise.resolve(
        ok([
          { name: "lophn", label: "Lophn", kind: "lophn" },
          { name: "coding_codex", label: "Codex", kind: "codex" },
        ]),
      ),
  };
  const service = createWorkflowService({
    files,
    projects: {
      resolve: () =>
        Promise.resolve(ok({ id: PRJ as Id<"prj">, name: "demo" })),
      nameOf: () => Promise.resolve(ok("demo")),
    },
    agents,
    turns: {} as never,
    store: {} as never,
    flows: {} as never,
    remote: {} as never,
    ids: createIdSource({
      clock: { now: () => AT } as never,
      random: {} as never,
    }),
    logger,
  });

  const listed = await service.list({ project: "demo" }, null);
  assert.ok(listed.ok);
  assert.equal(listed.value.workflows.length, 3);
  assert.deepStrictEqual(listed.value.callable_agents, [
    { name: "lophn", label: "Lophn", kind: "lophn" },
    { name: "coding_codex", label: "Codex", kind: "codex" },
  ]);

  const good = listed.value.workflows.find((w) => w.name === "good")!;
  assert.equal(good.startable, true);
  assert.ok(good.inputs?.env !== undefined);
  assert.ok(good.outputs?.report !== undefined);

  const badSelect = listed.value.workflows.find(
    (w) => w.name === "bad-select",
  )!;
  assert.equal(badSelect.startable, false);
  assert.equal(badSelect.problem?.reason, "invalid_inputs");

  const badType = listed.value.workflows.find((w) => w.name === "bad-type")!;
  assert.equal(badType.startable, false);
  assert.equal(badType.problem?.reason, "invalid_inputs");
});

test("StartWorkflow validates inputs (required, when-hidden, callable agent), injects Inputs: into YAML body, and forwards redacted inputs to flow launch", async () => {
  const h = makeHarness();
  try {
    h.db.exec(WORKFLOW_INPUTS_SCHEMA_STEP.sql);
    const agentYaml = [
      "kind: agent",
      "inputs:",
      "  mode:",
      "    type: select",
      "    options: [fast, deep]",
      "    default: fast",
      "  reviewer:",
      "    type: agent",
      "    required: true",
      "  deep_reason:",
      "    type: string",
      "    required: true",
      "    when:",
      "      field: mode",
      "      equals: deep",
      "  tags:",
      "    type: multiselect",
      "    options: [smoke, perf]",
      "participants:",
      "  worker: { agent: lophn }",
      "steps:",
      "  plan:",
      "    by: worker",
      "    prompt: Make a plan",
    ].join("\n");
    const flowYaml = [
      "kind: flow",
      'flow_sdk: "2.0.0"',
      "inputs:",
      "  token_note:",
      "    type: string",
      "    required: true",
      "  retries:",
      "    type: number",
      "    default: 2",
      "steps:",
      "  run: {}",
    ].join("\n");

    const launched: unknown[] = [];
    const secret = "SECRET_INPUT_VALUE_424242";
    const registry = createKnownSecretRegistry();
    registry.register([secret]);
    const readyRedactor = createProductRedactor({
      match: (t) => registry.match(t),
      ready: true,
    });
    const redactionSource = {
      concern: "workflows",
      revision: "1",
      scope: "step-text",
    };

    let idSeq = 0;
    const service = createWorkflowService({
      files: {
        list: () =>
          Promise.resolve(
            ok([
              {
                name: "agent-wf",
                declaration: agentYaml,
                flow: false,
                artifacts: { static: false, instance: false },
              },
              {
                name: "flow-wf",
                declaration: flowYaml,
                flow: true,
                artifacts: { static: false, instance: false },
              },
            ]),
          ),
      },
      projects: {
        resolve: () =>
          Promise.resolve(ok({ id: PRJ as Id<"prj">, name: "demo" })),
        nameOf: () => Promise.resolve(ok("demo")),
      },
      agents: {
        listCallable: () =>
          Promise.resolve(
            ok([
              { name: "lophn", label: "Lophn", kind: "lophn" },
              { name: "coding_codex", label: "Codex", kind: "codex" },
            ]),
          ),
      },
      turns: {
        stopSession: () => Promise.resolve(ok(undefined)),
        stepTurn: () => Promise.resolve(ok(null)),
        openOutgoingCalls: () => Promise.resolve(ok(0)),
      },
      remote: {
        computer: () => err({ code: "not_found", message: "none" }),
        workspace: () => err({ code: "not_found", message: "none" }),
        isPrivate: () => false,
        receivedStep: () => Promise.resolve(ok(null)),
        report: () => Promise.resolve(ok(undefined)),
        handOf: () => ok(null),
      },
      flows: {
        launch: (start) => {
          launched.push(start);
          return Promise.resolve(ok(undefined));
        },
        stop: () => Promise.resolve(ok(undefined)),
      },
      store: {
        create: (input) => {
          // withStepText와 같은 재귀 redaction 경로를 거쳐 저장된다.
          let redactedInputs = input.inputs;
          if (redactedInputs !== undefined) {
            const done = redactJsonValues(redactedInputs, (t) =>
              readyRedactor(redactionSource, "text/plain", t),
            );
            assert.ok(done.ok);
            redactedInputs = done.value as Record<string, unknown>;
          }
          return Promise.resolve(
            h.commands.create.handle(
              h.tx,
              h.ctx,
              {
                ...input,
                ...(redactedInputs !== undefined
                  ? { inputs: redactedInputs }
                  : {}),
              },
              {},
            ),
          );
        },
        apply: (input, compare) =>
          Promise.resolve(h.commands.apply.handle(h.tx, h.ctx, input, compare)),
        read: (id) => {
          const instance = loadInstance(h.sql, id);
          const lines = loadLines(h.sql, id, { after: 0, limit: null });
          const reports = lastReports(h.sql, id);
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
        running: () => Promise.resolve(runningInstances(h.sql)),
      },
      ids: {
        newId: (prefix: string) =>
          `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzz${String.fromCharCode(97 + idSeq++)}`,
      } as never,
      logger,
    });

    // 1) missing required field -> invalid_input
    const missing = await service.start(
      { workflow: "demo/agent-wf", text: "go", inputs: {} },
      { kind: "user" },
    );
    assert.ok(!missing.ok);
    assert.equal(missing.error.code, "invalid_input");
    assert.match(missing.error.message, /reviewer/);

    // 2) invalid (uncallable) agent -> invalid_input
    const badAgent = await service.start(
      {
        workflow: "demo/agent-wf",
        text: "go",
        inputs: { reviewer: "ghost_agent" },
      },
      { kind: "user" },
    );
    assert.ok(!badAgent.ok);
    assert.equal(badAgent.error.code, "invalid_input");
    assert.match(badAgent.error.message, /ghost_agent/);

    // 3) when-hidden required field (deep_reason when mode=fast) is skipped and excluded;
    //    valid callable agent passes and Inputs: is injected into the first step hand-off body.
    const startedAgent = await service.start(
      {
        workflow: "demo/agent-wf",
        text: "Check latency",
        inputs: {
          reviewer: "coding_codex",
          tags: ["smoke", "perf"],
          deep_reason: "should be stripped",
        },
      },
      { kind: "user" },
    );
    assert.ok(startedAgent.ok);
    assert.deepStrictEqual(startedAgent.value.instance.inputs, {
      mode: "fast",
      reviewer: "coding_codex",
      tags: ["smoke", "perf"],
    });
    assert.equal(h.delivered.length, 1);
    const bodyText = blocksText(h.delivered[0]!.input.body);
    assert.match(bodyText, /Inputs:/);
    assert.match(bodyText, /- mode: fast/);
    assert.match(bodyText, /- reviewer: coding_codex/);
    assert.match(bodyText, /- tags: smoke, perf/);
    assert.ok(!bodyText.includes("deep_reason"));
    assert.match(bodyText, /Received:\nCheck latency/);

    // 4) flow workflow persists redacted inputs and forwards redacted inputs to flows.launch
    const startedFlow = await service.start(
      {
        workflow: "demo/flow-wf",
        text: "run flow",
        inputs: { token_note: `bearer=${secret}` },
      },
      { kind: "user" },
    );
    assert.ok(startedFlow.ok);
    const storedNote = String(startedFlow.value.instance.inputs?.token_note);
    assert.ok(!storedNote.includes(secret));
    assert.equal(startedFlow.value.instance.inputs?.retries, 2);
    assert.equal(launched.length, 1);
    const launchArg = launched[0] as { inputs?: Record<string, unknown> };
    assert.deepStrictEqual(launchArg.inputs, startedFlow.value.instance.inputs);
  } finally {
    h.db.close();
  }
});

test("redactJsonValues recursively redacts strings across nested objects/arrays and fails closed when unready", () => {
  const secret = "TOP_SECRET_NESTED_KEY_99999";
  const registry = createKnownSecretRegistry();
  registry.register([secret]);
  const ready = createProductRedactor({
    match: (t) => registry.match(t),
    ready: true,
  });
  const unready = createProductRedactor({
    match: (t) => registry.match(t),
    ready: false,
  });
  const src = { concern: "workflows", revision: "1", scope: "step-text" };
  const sample = {
    plain: "ok",
    token: `api=${secret}`,
    nested: {
      list: ["a", `inner=${secret}`],
      count: 3,
      flag: true,
      empty: null,
    },
  };

  const redacted = redactJsonValues(sample, (t) => ready(src, "text/plain", t));
  assert.ok(redacted.ok);
  const out = redacted.value as typeof sample;
  assert.equal(out.plain, "ok");
  assert.ok(!out.token.includes(secret));
  assert.ok(!String(out.nested.list[1]).includes(secret));
  assert.equal(out.nested.count, 3);
  assert.equal(out.nested.flag, true);
  assert.equal(out.nested.empty, null);

  const failedClosed = redactJsonValues(sample, (t) =>
    unready(src, "text/plain", t),
  );
  assert.equal(failedClosed.ok, false);

  // stepBody omits Inputs: when inputs is undefined or empty
  const noInputsBody = stepBody({
    step: {
      name: "s",
      by: "w",
      with: null,
      prompt: "Prompt",
      in: "",
      out: "",
      next: [],
    },
    received: "hello",
    inputs: {},
  });
  assert.ok(!noInputsBody.includes("Inputs:"));
});

test("flow_sdk status blocks missing/old flow_sdk (< supported_from) in list and StartWorkflow while allowing available/current", async () => {
  const filesList: DefinitionFile[] = [
    {
      name: "unstamped",
      declaration: "agent: lophn\n",
      flow: true,
      artifacts: { static: false, instance: false },
    },
    {
      name: "old-sdk",
      declaration: 'flow_sdk: "1.0.0"\nagent: lophn\n',
      flow: true,
      artifacts: { static: false, instance: false },
    },
    {
      name: "available-sdk",
      declaration: 'flow_sdk: "2.0.0"\nagent: lophn\n',
      flow: true,
      artifacts: { static: false, instance: false },
    },
    {
      name: "current-sdk",
      declaration: 'flow_sdk: "2.1.0"\nagent: lophn\n',
      flow: true,
      artifacts: { static: false, instance: false },
    },
  ];
  const service = createWorkflowService({
    files: {
      list: () => Promise.resolve(ok(filesList)),
      flowSdkInfo: () =>
        Promise.resolve({ current: "2.1.0", supported_from: "2.0.0" }),
    },
    projects: {
      resolve: () =>
        Promise.resolve(ok({ id: PRJ as Id<"prj">, name: "demo" })),
      nameOf: () => Promise.resolve(ok("demo")),
    },
    turns: {} as never,
    store: {} as never,
    flows: {} as never,
    remote: {} as never,
    ids: createIdSource({
      clock: { now: () => AT } as never,
      random: {} as never,
    }),
    logger,
  });

  const listed = await service.list({ project: "demo" }, null);
  assert.ok(listed.ok);
  const byName = new Map(listed.value.workflows.map((w) => [w.name, w]));

  const unstamped = byName.get("unstamped")!;
  assert.equal(unstamped.flow_sdk, "1.0.0");
  assert.equal(unstamped.flow_sdk_status, "required");
  assert.equal(unstamped.startable, false);
  assert.equal(unstamped.problem?.reason, "broken_flow");

  const oldSdk = byName.get("old-sdk")!;
  assert.equal(oldSdk.flow_sdk, "1.0.0");
  assert.equal(oldSdk.flow_sdk_status, "required");
  assert.equal(oldSdk.startable, false);

  const availSdk = byName.get("available-sdk")!;
  assert.equal(availSdk.flow_sdk, "2.0.0");
  assert.equal(availSdk.flow_sdk_status, "available");
  assert.equal(availSdk.startable, true);

  const curSdk = byName.get("current-sdk")!;
  assert.equal(curSdk.flow_sdk, "2.1.0");
  assert.equal(curSdk.flow_sdk_status, "current");
  assert.equal(curSdk.startable, true);

  // StartWorkflow rejects required flow_sdk with conflict mentioning @lophn/flow migration.
  for (const blockedName of ["unstamped", "old-sdk"]) {
    const res = await service.start(
      { workflow: `demo/${blockedName}`, text: "go" },
      { kind: "user" },
    );
    assert.ok(!res.ok);
    assert.equal(res.error.code, "conflict");
    assert.match(res.error.message, /@lophn\/flow/);
  }
});

test("WorkflowRename and WorkflowDelete enforce existence/conflicts, stop running instances, update ledger/layout, and emit events", async () => {
  const h = makeHarness();
  try {
    // Seed a running instance of "old-wf" so WorkflowDelete must stop it.
    const created = h.commands.create.handle(
      h.tx,
      h.ctx,
      {
        id: AGENT,
        project: PRJ,
        workflow: "old-wf",
        input: "go",
        participants: { worker: { agent: "lophn" } },
        steps: [
          {
            name: "work",
            by: "worker",
            with: null,
            prompt: "do work",
            in: "",
            out: "",
            next: ["end"],
          },
        ],
        started_by: { kind: "user" },
        handoff: null,
      },
      {},
    );
    assert.ok(created.ok);

    let wfNames = ["old-wf", "existing-wf"];
    const events: unknown[] = [];
    const layoutCalls: unknown[] = [];
    const stoppedFlows: string[] = [];

    const service = createWorkflowService({
      files: {
        list: () =>
          Promise.resolve(
            ok(
              wfNames.map((name) => ({
                name,
                declaration: 'flow_sdk: "2.0.0"\nagent: lophn\n',
                flow: true,
                artifacts: { static: false, instance: false },
              })),
            ),
          ),
        rename: async (_prj, from, to) => {
          wfNames = wfNames.map((n) => (n === from ? to : n));
          return ok(undefined);
        },
        remove: async (_prj, name) => {
          wfNames = wfNames.filter((n) => n !== name);
          return ok(undefined);
        },
      },
      projects: {
        resolve: () =>
          Promise.resolve(ok({ id: PRJ as Id<"prj">, name: "demo" })),
        nameOf: () => Promise.resolve(ok("demo")),
      },
      turns: {
        stopSession: () => Promise.resolve(ok(undefined)),
        stepTurn: () => Promise.resolve(ok(null)),
        openOutgoingCalls: () => Promise.resolve(ok(0)),
      },
      remote: {
        computer: () => err({ code: "not_found", message: "none" }),
        workspace: () => err({ code: "not_found", message: "none" }),
        isPrivate: () => false,
        receivedStep: () => Promise.resolve(ok(null)),
        report: () => Promise.resolve(ok(undefined)),
        handOf: () => ok(null),
      },
      flows: {
        launch: () => Promise.resolve(ok(undefined)),
        stop: (id) => {
          stoppedFlows.push(id);
          return Promise.resolve(ok(undefined));
        },
      },
      store: {
        create: (input) =>
          Promise.resolve(h.commands.create.handle(h.tx, h.ctx, input, {})),
        apply: (input, compare) =>
          Promise.resolve(h.commands.apply.handle(h.tx, h.ctx, input, compare)),
        read: (id) => {
          const instance = loadInstance(h.sql, id);
          const lines = loadLines(h.sql, id, { after: 0, limit: null });
          const reports = lastReports(h.sql, id);
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
        running: () => Promise.resolve(runningInstances(h.sql)),
      },
      lifecycle: {
        renameLedger: async (project, from, to) => {
          h.sql.run(
            "UPDATE workflow_instances SET workflow = ? WHERE project = ? AND workflow = ?",
            [to, project, from],
          );
          return ok({ updated_jobs: 2 });
        },
        deleteLedger: async () => ok({ erased_jobs: 3 }),
        updateLayoutOnRename: async (_p, from, to) => {
          layoutCalls.push(["rename", from, to]);
        },
        updateLayoutOnDelete: async (_p, name) => {
          layoutCalls.push(["delete", name]);
        },
        publishRenamed: (_p, from, to) => {
          events.push(["WorkflowRenamed", from, to]);
        },
        publishRemoved: (_p, name) => {
          events.push(["WorkflowRemoved", name]);
        },
      },
      ids: createIdSource({
        clock: { now: () => AT } as never,
        random: {} as never,
      }),
      logger,
    });

    // Rename missing -> not_found; rename to existing -> conflict.
    const missingRename = await service.rename(
      { project: PRJ as Id<"prj">, from: "ghost", to: "new-wf" },
      null,
    );
    assert.ok(!missingRename.ok);
    assert.equal(missingRename.error.code, "not_found");

    const conflictRename = await service.rename(
      { project: PRJ as Id<"prj">, from: "old-wf", to: "existing-wf" },
      null,
    );
    assert.ok(!conflictRename.ok);
    assert.equal(conflictRename.error.code, "conflict");

    // Rename succeeds, updates workflow_instances and emits WorkflowRenamed.
    const renamed = await service.rename(
      { project: PRJ as Id<"prj">, from: "old-wf", to: "renamed-wf" },
      null,
    );
    assert.ok(renamed.ok);
    assert.deepEqual(renamed.value, {
      project: PRJ,
      from: "old-wf",
      to: "renamed-wf",
      updated_jobs: 2,
    });
    const instAfterRename = loadInstance(h.sql, AGENT);
    assert.ok(
      instAfterRename.ok && instAfterRename.value?.workflow === "renamed-wf",
    );

    // Delete missing -> not_found.
    const missingDelete = await service.remove(
      { project: PRJ as Id<"prj">, name: "ghost" },
      null,
    );
    assert.ok(!missingDelete.ok);
    assert.equal(missingDelete.error.code, "not_found");

    // Delete stops running instance of renamed-wf, erases jobs, removes folder, updates layout, emits WorkflowRemoved.
    const deleted = await service.remove(
      { project: PRJ as Id<"prj">, name: "renamed-wf" },
      null,
    );
    assert.ok(deleted.ok);
    assert.deepEqual(deleted.value, {
      project: PRJ,
      name: "renamed-wf",
      erased_jobs: 3,
      follow_ups: [],
      handoff_session: null,
    });
    const instAfterDelete = loadInstance(h.sql, AGENT);
    assert.ok(instAfterDelete.ok && instAfterDelete.value?.state === "stopped");
    assert.deepEqual(stoppedFlows, [AGENT]);
    assert.deepEqual(layoutCalls, [
      ["rename", "old-wf", "renamed-wf"],
      ["delete", "renamed-wf"],
    ]);
    assert.deepEqual(events, [
      ["WorkflowRenamed", "old-wf", "renamed-wf"],
      ["WorkflowRemoved", "renamed-wf"],
    ]);
  } finally {
    h.db.close();
  }
});

test("workspace layout JSON helpers rename and remove workflow desks and tabs cleanly without merging into _default", () => {
  const initial = JSON.stringify({
    schema_version: 13,
    active_desk: "old-wf",
    desks: {
      _default: {
        label: "Main",
        tabs: [
          { kind: "workflow", key: "workflow:old-wf", workflow: "old-wf" },
          { kind: "terminal", key: "host:t1", terminal: "t1" },
        ],
        selected_tab: "workflow:old-wf",
        groups: [
          {
            layout: {
              dir: "row",
              ratio: 0.5,
              a: { tab: "workflow:old-wf" },
              b: { tab: "host:t1" },
            },
            focus: "workflow:old-wf",
          },
        ],
        floats: [],
        detached: [],
      },
      "old-wf": {
        label: "old-wf",
        workflow: "old-wf",
        tabs: [
          { kind: "workflow", key: "workflow:old-wf", workflow: "old-wf" },
          {
            kind: "artifact",
            key: `artifact-workflow:${PRJ}:old-wf:static`,
            project: PRJ,
            workflow: "old-wf",
            view: "static",
          },
        ],
        selected_tab: "workflow:old-wf",
        groups: [],
        floats: [],
        detached: [],
      },
    },
  });

  const renamedText = renameWorkflowInLayoutText(initial, "old-wf", "new-wf");
  assert.ok(renamedText !== null);
  const renamed = JSON.parse(renamedText);
  assert.equal(renamed.active_desk, "new-wf");
  assert.equal("old-wf" in renamed.desks, false);
  assert.equal(renamed.desks["new-wf"].workflow, "new-wf");
  assert.equal(renamed.desks["new-wf"].label, "new-wf");
  assert.equal(renamed.desks["new-wf"].selected_tab, "workflow:new-wf");
  assert.equal(renamed.desks["new-wf"].tabs[0].key, "workflow:new-wf");
  assert.equal(renamed.desks["new-wf"].tabs[0].workflow, "new-wf");
  assert.equal(
    renamed.desks["new-wf"].tabs[1].key,
    `artifact-workflow:${PRJ}:new-wf:static`,
  );
  assert.equal(renamed.desks._default.selected_tab, "workflow:new-wf");
  assert.equal(renamed.desks._default.groups[0].focus, "workflow:new-wf");
  assert.equal(
    renamed.desks._default.groups[0].layout.a.tab,
    "workflow:new-wf",
  );

  const removedText = removeWorkflowFromLayoutText(renamedText, "new-wf");
  assert.ok(removedText !== null);
  const removed = JSON.parse(removedText);
  assert.equal(removed.active_desk, "_default");
  assert.equal("new-wf" in removed.desks, false);
  assert.deepEqual(
    removed.desks._default.tabs.map((t: { key: string }) => t.key),
    ["host:t1"],
  );
  assert.equal(removed.desks._default.selected_tab, "host:t1");
  assert.deepEqual(removed.desks._default.groups, []);
});
