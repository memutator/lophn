import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  createWorkflowFiles,
  removeWorkflowFromLayoutText,
  renameWorkflowInLayoutText,
} from "../main/daemon/wiring/workflows-files.ts";
import { createRouter } from "../router/mod.ts";
import type { RoutedInput } from "../router/ports.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { WORKFLOW_CHECKPOINTS_SCHEMA_STEP } from "./checkpoint-schema.ts";
import { createWorkflowCommands } from "./commands.ts";
import { entryOf } from "./declaration.ts";
import { WORKFLOW_INPUTS_SCHEMA_STEP } from "./inputs-schema.ts";
import { workflowLinesSchemaSteps } from "./lines-schema.ts";
import { WORKFLOW_ONEOFF_OVERRIDE_SCHEMA_STEP } from "./oneoff-override-schema.ts";
import { WORKFLOW_OPEN_MODE_SCHEMA_STEP } from "./open-mode-schema.ts";
import { WORKFLOW_PARTICIPANT_MODES_SCHEMA_STEP } from "./participant-modes-schema.ts";
import { redactJsonValues, stepBody } from "./plan.ts";
import type {
  DefinitionFile,
  StepTurn,
  WorkflowAgents,
  WorkflowFiles,
  WorkflowFlows,
  WorkflowRemote,
} from "./ports.ts";
import { createWorkflowReads, deriveWorkflowStatus } from "./reads.ts";
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
import { WORKFLOW_TITLE_SCHEMA_STEP } from "./title-schema.ts";

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
const TRN_2 = "trn_01hzzzzzzzzzzzzzzzzzzzzzzb" as Id<"trn">;
const lophnAtWorkspace = { agent: "lophn", workspace: null } as const;

function makeHarness(options?: {
  openCalls?: () => number;
  stepTurn?: () => StepTurn | null;
  resolveOpen?: () => boolean;
  pendingMessages?: () => boolean;
  turnRunning?: () => boolean;
  lastTurn?: () => StepTurn | null;
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
  let pendingMessages = options?.pendingMessages ?? (() => false);
  let turnRunning = options?.turnRunning ?? (() => false);
  let lastTurn = options?.lastTurn ?? (() => null);
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
      hasPendingMessages: () => Promise.resolve(ok(pendingMessages())),
      isTurnRunning: () => Promise.resolve(ok(turnRunning())),
      lastTurn: () => Promise.resolve(ok(lastTurn())),
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
    setPendingMessages(fn: () => boolean) {
      pendingMessages = fn;
    },
    setTurnRunning(fn: () => boolean) {
      turnRunning = fn;
    },
    setLastTurn(fn: () => StepTurn | null) {
      lastTurn = fn;
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

    // 열린 call이 0이어도 미소비 대기 메시지·실행 중인 후속 turn·더 새 turn이 있으면 stall로 보지 않는다.
    h.setOpenCalls(() => 0);
    h.setPendingMessages(() => true);
    await h.service.turnEnded({
      session: SES_A,
      turn: TRN_1,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    h.setPendingMessages(() => false);
    h.setTurnRunning(() => true);
    await h.service.turnEnded({
      session: SES_A,
      turn: TRN_1,
      outcome: { kind: "completed", reason: "answer_completed" },
      error: null,
    });
    h.setTurnRunning(() => false);
    h.setLastTurn(() => ({
      turn: TRN_2,
      state: "finished",
      outcome: { kind: "completed", reason: "answer_completed" },
    }));
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

    // 열린 call·대기 메시지·후속 turn이 모두 없는 상태에서 실패로 끝나면 실패 이유와 함께 step_stalled를 남긴다.
    h.setLastTurn(() => ({
      turn: TRN_1,
      state: "finished",
      outcome: { kind: "failed", reason: "model_error" },
    }));
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
    h.db.exec(WORKFLOW_TITLE_SCHEMA_STEP.sql);
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
    const titleRequests: Array<{ instance: string; expected: string | null }> =
      [];
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
      onTitleNeeded: (req) => {
        titleRequests.push(req);
      },
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
    assert.equal(titleRequests.length, 2);
    assert.equal(startedAgent.value.instance.title, "Check latency");
    assert.equal(startedFlow.value.instance.title, "run flow");

    // 5) explicit title is stored verbatim (trimmed) and skips AI auto-title request
    const explicitAgent = await service.start(
      {
        workflow: "demo/agent-wf",
        title: "  Latency audit  ",
        text: "Check latency again",
        inputs: { reviewer: "coding_codex" },
      },
      { kind: "user" },
    );
    assert.ok(explicitAgent.ok);
    assert.equal(explicitAgent.value.instance.title, "Latency audit");
    assert.equal(titleRequests.length, 2);

    const explicitFlow = await service.start(
      {
        workflow: "demo/flow-wf",
        title: "Nightly release flow",
        text: "run flow again",
        inputs: { token_note: "ok" },
      },
      { kind: "user" },
    );
    assert.ok(explicitFlow.ok);
    assert.equal(explicitFlow.value.instance.title, "Nightly release flow");
    assert.equal(titleRequests.length, 2);
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

test("ExportWorkflow and ImportWorkflow round-trip workflow folders, skip symlinks/node_modules, enforce conflict/overwrite, and reject path traversal", async () => {
  const rootA = await mkdtemp(join(tmpdir(), "lophn-wf-export-a-"));
  const rootB = await mkdtemp(join(tmpdir(), "lophn-wf-export-b-"));
  const outside = await mkdtemp(join(tmpdir(), "lophn-wf-export-outside-"));
  try {
    const srcDir = join(rootA, "projects", PRJ, "workflows", "ship-it");
    await mkdir(join(srcDir, "artifacts", "static"), { recursive: true });
    await mkdir(join(srcDir, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(srcDir, "workflow.yaml"),
      "participants:\n  a: { agent: lophn }\nsteps:\n  go: { by: a, prompt: hi }\n",
    );
    await writeFile(join(srcDir, "flow.ts"), "export const v = 1;\n");
    await writeFile(
      join(srcDir, "artifacts", "static", "index.html"),
      "<h1>hi</h1>",
    );
    await writeFile(join(srcDir, "node_modules", "pkg", "index.js"), "ignored");
    await writeFile(join(outside, "secret.txt"), "do-not-export");
    await symlink(join(outside, "secret.txt"), join(srcDir, "leak.txt"));

    const importedEvents: string[] = [];
    const makeSvc = (root: string) =>
      createWorkflowService({
        files: createWorkflowFiles(root),
        projects: {
          resolve: () =>
            Promise.resolve(ok({ id: PRJ as Id<"prj">, name: "demo" })),
          nameOf: () => Promise.resolve(ok("demo")),
        },
        turns: {} as never,
        store: {} as never,
        flows: {} as never,
        remote: {} as never,
        lifecycle: {
          renameLedger: () => Promise.resolve(ok({ updated_jobs: 0 })),
          deleteLedger: () => Promise.resolve(ok({ erased_jobs: 0 })),
          publishImported: (project, name) =>
            importedEvents.push(`${project}:${name}`),
        },
        ids: {
          newId: (prefix: string) =>
            `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzze` as never,
        },
        logger,
      });

    const svcA = makeSvc(rootA);
    const svcB = makeSvc(rootB);

    const exported = await svcA.exportWorkflow({
      project: PRJ as Id<"prj">,
      name: "ship-it",
    });
    assert.ok(exported.ok);
    assert.deepEqual(
      exported.value.files.map((f) => f.path),
      ["artifacts/static/index.html", "flow.ts", "workflow.yaml"],
    );

    const firstImport = await svcB.importWorkflow({
      project: PRJ as Id<"prj">,
      name: "ship-it",
      files: exported.value.files,
    });
    assert.ok(firstImport.ok);
    assert.equal(firstImport.value.files_written, 3);
    assert.deepEqual(importedEvents, [`${PRJ}:ship-it`]);
    assert.equal(
      await readFile(
        join(
          rootB,
          "projects",
          PRJ,
          "workflows",
          "ship-it",
          "artifacts",
          "static",
          "index.html",
        ),
        "utf8",
      ),
      "<h1>hi</h1>",
    );

    // 같은 이름이 이미 있으면 overwrite 없이 conflict로 거절한다.
    const dup = await svcB.importWorkflow({
      project: PRJ as Id<"prj">,
      name: "ship-it",
      files: exported.value.files,
    });
    assert.ok(!dup.ok);
    assert.equal(dup.error.code, "conflict");

    // overwrite: true면 기존 폴더를 원자적으로 교체한다.
    const updatedFiles = exported.value.files.map((f) =>
      f.path === "flow.ts"
        ? {
            ...f,
            content_base64: Buffer.from("export const v = 2;\n").toString(
              "base64",
            ),
          }
        : f,
    );
    const overwritten = await svcB.importWorkflow({
      project: PRJ as Id<"prj">,
      name: "ship-it",
      files: updatedFiles,
      overwrite: true,
    });
    assert.ok(overwritten.ok);
    assert.equal(
      await readFile(
        join(rootB, "projects", PRJ, "workflows", "ship-it", "flow.ts"),
        "utf8",
      ),
      "export const v = 2;\n",
    );

    // 상위 경로 탈출은 거절한다.
    const traversal = await svcB.importWorkflow({
      project: PRJ as Id<"prj">,
      name: "evil",
      files: [
        {
          path: "workflow.yaml",
          content_base64: Buffer.from("steps: {}\n").toString("base64"),
        },
        {
          path: "../escape.txt",
          content_base64: Buffer.from("nope").toString("base64"),
        },
      ],
    });
    assert.ok(!traversal.ok);
    assert.equal(traversal.error.code, "invalid_input");
  } finally {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("SetWorkflowDefaults preserves YAML comments and anchors, validates inputs/symlinks, and StartWorkflow uses saved default_step", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-wf-defaults-"));
  const outside = await mkdtemp(join(tmpdir(), "lophn-wf-defaults-out-"));
  try {
    const wfDir = join(root, "projects", PRJ, "workflows", "cleanroom");
    await mkdir(wfDir, { recursive: true });
    const initialYaml = [
      "# top comment must stay",
      "inputs:",
      "  mode:",
      "    type: select",
      "    default: auto",
      "    options:",
      "      - auto",
      "      - never",
      "participants:",
      "  a: { agent: lophn }",
      "  b: { agent: lophn }",
      "steps:",
      "  first:",
      "    by: a",
      "    prompt: &shared_prompt |",
      "      do work",
      "    next: [end]",
      "  second:",
      "    by: b",
      "    prompt: *shared_prompt",
      "    next: [end]",
      "",
    ].join("\n");
    const declPath = join(wfDir, "workflow.yaml");
    await writeFile(declPath, initialYaml, "utf8");

    const files = createWorkflowFiles(root);
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(workflowsSchemaSteps[0]!.sql);
      db.exec(workflowLinesSchemaSteps[0]!.sql);
      db.exec(WORKFLOW_INPUTS_SCHEMA_STEP.sql);
      const sql = createSql(db, () => true);
      const tx = {
        sql,
        now: () => AT,
        newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzd`,
        port: () => ({ push: () => {} }),
      } as unknown as Tx;
      const delivered: { session: string; input: RoutedInput }[] = [];
      const router = createRouter({
        directory: {
          find: () => null,
          resolveAddress: () => ok(lophnAtWorkspace),
          archive: () => ok(false),
          membersOn: () => [],
          membersFrom: () => [],
          membersUnder: () => [],
          setWorkflowOrigin: () => {},
          openMember: () => err({ code: "forbidden", message: "none" }),
          open: () =>
            ok({
              session: SES_A,
              transport: "lophn",
              agent: lophnAtWorkspace,
              accepting: true,
              open: true,
              spawned_by: null,
              opened_by_machine: null,
              runs_on: null,
            } as never),
          app: () => null,
          accepts: () => null,
          listOpen: () => [],
          projectOfIdentity: () => null,
          identityOfProject: () => ok("pri_test"),
          appIdOf: () => err({ code: "not_found", message: "none" }),
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
      const svc = createWorkflowService({
        files,
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
        logger,
        store: {
          create: (input) =>
            Promise.resolve(commands.create.handle(tx, ctx, input, {})),
          apply: (input, compare) =>
            Promise.resolve(commands.apply.handle(tx, ctx, input, compare)),
          read: () =>
            Promise.resolve(err({ code: "not_found", message: "none" })),
          running: () => Promise.resolve(ok([])),
        },
        flows: {
          launch: () => Promise.resolve(ok(undefined)),
          stop: () => Promise.resolve(ok(undefined)),
        },
        ids: {
          newId: (prefix: string) =>
            `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzze` as never,
        },
      });

      const saved = await svc.setDefaults({
        project: PRJ as Id<"prj">,
        workflow: "cleanroom",
        default_step: "second",
        step_open: { second: "tab" },
        inputs: { mode: "never" },
      });
      assert.ok(saved.ok);
      assert.equal(saved.value.entry.default_step, "second");
      assert.equal(saved.value.entry.inputs?.["mode"]?.default, "never");
      assert.equal(
        saved.value.entry.steps?.find((s) => s.name === "second")?.open,
        "tab",
      );

      const rewritten = await readFile(declPath, "utf8");
      assert.ok(rewritten.includes("# top comment must stay"));
      assert.ok(rewritten.includes("&shared_prompt"));
      assert.ok(rewritten.includes("*shared_prompt"));

      // invalid select option은 거절하고 파일은 그대로 유지한다.
      const invalid = await svc.setDefaults({
        project: PRJ as Id<"prj">,
        workflow: "cleanroom",
        inputs: { mode: "bogus" },
      });
      assert.ok(!invalid.ok);
      assert.equal(invalid.error.code, "invalid_input");

      // step을 생략하고 시작하면 저장된 default_step(second)으로 시작한다.
      const started = await svc.start(
        { workflow: "demo/cleanroom", text: "go" },
        { kind: "user" },
      );
      assert.ok(started.ok);
      assert.equal(started.value.handed?.step, "second");

      // symlink workflow.yaml 쓰기는 forbidden으로 차단한다.
      const outsideYaml = join(outside, "workflow.yaml");
      await writeFile(outsideYaml, initialYaml, "utf8");
      const symDir = join(root, "projects", PRJ, "workflows", "linked");
      await mkdir(symDir, { recursive: true });
      await symlink(outsideYaml, join(symDir, "workflow.yaml"));
      const symRes = await svc.setDefaults({
        project: PRJ as Id<"prj">,
        workflow: "linked",
        inputs: { mode: "never" },
      });
      assert.ok(!symRes.ok);
      assert.equal(symRes.error.code, "forbidden");
    } finally {
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("workflow participant_modes precedence, harness exclusion, and sub-workflow minPermissionMode clamping", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(workflowsSchemaSteps[0]!.sql);
    db.exec(workflowLinesSchemaSteps[0]!.sql);
    db.exec(WORKFLOW_INPUTS_SCHEMA_STEP.sql);
    db.exec(WORKFLOW_PARTICIPANT_MODES_SCHEMA_STEP.sql);
    const sql = createSql(db, () => true);
    const tx = {
      sql,
      now: () => AT,
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzz9`,
      port: () => ({ push: () => {} }),
    } as unknown as Tx;
    const routedModes: Array<{ step: string; mode: string | undefined }> = [];
    const fakeRouter = {
      route: (_tx: Tx, input: Record<string, unknown>) => {
        routedModes.push({
          step: String((input.step as { step?: string } | undefined)?.step),
          mode: input.permissionMode as string | undefined,
        });
        return ok({
          call: null,
          state: "done",
          fail_reason: null,
          session: "ses_01hzzzzzzzzzzzzzzzzzzzzzza",
        });
      },
    };
    const commands = createWorkflowCommands(() => ok(fakeRouter as never));
    const machineCtx = { actor: "machine" } as never;

    const parentDecl = [
      "participants:",
      "  planner:",
      "    agent: lophn",
      "  reviewer:",
      "    agent: reviewer",
      "  helper:",
      "    agent: custom-helper",
      "  coder:",
      "    agent: claude",
      "  custom_harness:",
      "    agent: my-codex",
      "  me:",
      "    kind: human",
      "steps:",
      "  plan:",
      "    by: planner",
      "    prompt: plan it",
      "    next: [end]",
    ].join("\n");
    const childDecl = [
      "participants:",
      "  worker:",
      "    agent: lophn",
      "  narrow:",
      "    agent: reviewer",
      "  coder:",
      "    agent: codex",
      "steps:",
      "  run:",
      "    by: worker",
      "    prompt: do child work",
      "    next: [end]",
    ].join("\n");

    const files: WorkflowFiles = {
      list: () =>
        Promise.resolve(
          ok([
            {
              name: "parent-wf",
              declaration: parentDecl,
              flow: false,
              artifacts: { static: false, instance: false },
            },
            {
              name: "child-wf",
              declaration: childDecl,
              flow: false,
              artifacts: { static: false, instance: false },
            },
          ]),
        ),
    };
    const agents: WorkflowAgents = {
      listCallable: () =>
        Promise.resolve(
          ok([
            { name: "lophn", kind: "lophn" },
            { name: "reviewer", kind: "custom" },
            { name: "custom-helper", kind: "custom" },
            { name: "claude", kind: "claude-code" },
            { name: "codex", kind: "codex" },
            { name: "my-codex", kind: "codex" },
          ]),
        ),
    };
    const remote: WorkflowRemote = {
      computer: () => err({ code: "not_found", message: "no peer" }),
      workspace: () => err({ code: "not_found", message: "no ws" }),
      isPrivate: () => false,
      receivedStep: () => Promise.resolve(ok(null)),
      report: () => Promise.resolve(ok(undefined)),
      handOf: () => ok(null),
    };

    let seq = 0;
    const svc = createWorkflowService({
      files,
      projects: {
        resolve: () =>
          Promise.resolve(ok({ id: PRJ as Id<"prj">, name: "demo" })),
        nameOf: () => Promise.resolve(ok("demo")),
      },
      agents,
      turns: {
        stopSession: () => Promise.resolve(ok(undefined)),
        stepTurn: () => Promise.resolve(ok(null)),
        openOutgoingCalls: () => Promise.resolve(ok(0)),
      },
      store: {
        create: (input) =>
          Promise.resolve(commands.create.handle(tx, machineCtx, input, {})),
        apply: (input, compare) =>
          Promise.resolve(
            commands.apply.handle(tx, machineCtx, input, compare),
          ),
        read: (instance) => {
          const inst = loadInstance(sql, instance);
          if (!inst.ok || inst.value === null) {
            return Promise.resolve(
              err({ code: "not_found", message: "not found" }),
            );
          }
          const lines = loadLines(sql, instance, { after: 0, limit: null });
          const reports = lastReports(sql, instance);
          return Promise.resolve(
            ok({
              instance: inst.value,
              lines: lines.ok ? lines.value : [],
              last_reports: reports.ok ? reports.value : {},
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
      remote,
      rememberedModesOf: (_project, workflow) =>
        workflow === "parent-wf"
          ? ({
              planner: "full",
              reviewer: "read_only",
              coder: "full",
            } as Record<string, "read_only" | "ask" | "workspace" | "full">)
          : ({
              worker: "full",
              narrow: "read_only",
            } as Record<string, "read_only" | "ask" | "workspace" | "full">),
      agentDefaultModeOf: (agent) =>
        agent === "custom-helper" ? "ask" : undefined,
      globalDefaultMode: () => "workspace",
      ids: {
        newId: (prefix) =>
          `${prefix}_01hzzzzzzzzzzzzzzzzzzzzz${String(seq++).padStart(2, "0")}`,
      },
      logger,
    });

    // 1) precedence: explicit step_modes > explicit participant_modes > remembered ("step:<name>" > participant)
    //    > agent default ("ask" for custom-helper) > global default; harness/human excluded.
    const parentStarted = await svc.start(
      {
        workflow: "demo/parent-wf",
        text: "run parent",
        participant_modes: {
          planner: "workspace",
          coder: "full",
          custom_harness: "full",
        },
        step_modes: {
          plan: "ask",
          code: "full",
        },
      },
      { kind: "user" },
    );
    assert.ok(parentStarted.ok);
    assert.deepStrictEqual(parentStarted.value.instance.participant_modes, {
      planner: "workspace",
      reviewer: "read_only",
      helper: "ask",
    });
    // Per-step mode overrides participant mode for lophn-agent steps; harness steps stay undefined.
    assert.equal(
      parentStarted.value.instance.steps.find((s) => s.name === "plan")
        ?.permission_mode,
      "ask",
    );
    assert.equal(
      parentStarted.value.instance.steps.find((s) => s.name === "code")
        ?.permission_mode,
      undefined,
    );
    assert.deepStrictEqual(routedModes[0], { step: "plan", mode: "ask" });

    // 2) job start ignores explicit participant_modes and uses remembered -> agent default -> global default.
    const jobStarted = await svc.start(
      {
        workflow: "demo/parent-wf",
        text: "run from job",
        participant_modes: { planner: "read_only" },
      },
      { kind: "job", job: "job_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"job"> },
    );
    assert.ok(jobStarted.ok);
    assert.deepStrictEqual(jobStarted.value.instance.participant_modes, {
      planner: "full",
      reviewer: "read_only",
      helper: "ask",
    });

    // 3) sub-workflow started by parent-wf (current step 'plan' is planner with mode "ask"):
    //    child's worker remembered "full" is clamped to min("ask", "full") = "ask",
    //    while child's narrow remembered "read_only" stays "read_only" (never widened),
    //    and harness coder is excluded.
    const childStarted = await svc.start(
      { workflow: "demo/child-wf", text: "run child" },
      { kind: "workflow", instance: parentStarted.value.instance.id },
    );
    assert.ok(childStarted.ok);
    assert.deepStrictEqual(childStarted.value.instance.participant_modes, {
      worker: "ask",
      narrow: "read_only",
    });
    assert.deepStrictEqual(routedModes.at(-1), { step: "run", mode: "ask" });
  } finally {
    db.close();
  }
});

test("one-off workflows, per-instance start overrides, live edits/override-code, and save promotion", async () => {
  const root = await mkdtemp(join(tmpdir(), "wf-oneoff-"));
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(workflowsSchemaSteps[0]!.sql);
    db.exec(workflowLinesSchemaSteps[0]!.sql);
    db.exec(WORKFLOW_INPUTS_SCHEMA_STEP.sql);
    db.exec(WORKFLOW_CHECKPOINTS_SCHEMA_STEP.sql);
    db.exec(WORKFLOW_OPEN_MODE_SCHEMA_STEP.sql);
    db.exec(WORKFLOW_TITLE_SCHEMA_STEP.sql);
    db.exec(WORKFLOW_PARTICIPANT_MODES_SCHEMA_STEP.sql);
    db.exec(WORKFLOW_ONEOFF_OVERRIDE_SCHEMA_STEP.sql);
    const sql = createSql(db, () => true);
    const tx = {
      sql,
      now: () => AT,
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzz9`,
      port: () => ({ push: () => {} }),
    } as unknown as Tx;
    const routed: Array<{ step: string; agent: string; body: string }> = [];
    const fakeRouter = {
      route: (_tx: Tx, input: Record<string, unknown>) => {
        const to = input.to as { agent?: string };
        const bodyBlocks = input.body as Array<{ text?: string }>;
        routed.push({
          step: String((input.step as { step?: string } | undefined)?.step),
          agent: String(to.agent ?? ""),
          body: bodyBlocks.map((b) => b.text ?? "").join("\n"),
        });
        return ok({
          call: null,
          state: "done",
          fail_reason: null,
          session: "ses_01hzzzzzzzzzzzzzzzzzzzzzza",
        });
      },
    };
    const commands = createWorkflowCommands(() => ok(fakeRouter as never));
    const reads = createWorkflowReads();
    const machineCtx = { actor: "machine" } as never;
    const readSnapshot = { sql, as_of_seq: "1" } as never;

    // Seed a base YAML workflow and a base flow workflow on disk.
    const baseYamlDir = join(root, "projects", PRJ, "workflows", "base-yaml");
    await mkdir(baseYamlDir, { recursive: true });
    const baseYamlText = [
      "participants:",
      "  worker: { agent: lophn }",
      "steps:",
      "  first:",
      "    by: worker",
      "    prompt: original prompt",
      "    next: [end]",
    ].join("\n");
    await writeFile(join(baseYamlDir, "workflow.yaml"), baseYamlText, "utf8");

    const baseFlowDir = join(root, "projects", PRJ, "workflows", "base-flow");
    await mkdir(baseFlowDir, { recursive: true });
    await writeFile(
      join(baseFlowDir, "workflow.yaml"),
      "flow_sdk: 2.1.0\nagent: lophn\n",
      "utf8",
    );
    const baseFlowCode =
      'import { report } from "@lophn/flow";\nawait report({ step: "run", text: "base", next: "end" });\n';
    await writeFile(join(baseFlowDir, "flow.ts"), baseFlowCode, "utf8");

    // In-memory content-addressed blob store for snapshots.
    const blobs = new Map<string, Uint8Array>();
    const blobStore = {
      put: async (bytes: Uint8Array) => {
        const { createHash } = await import("node:crypto");
        const hash = createHash("sha256").update(bytes).digest("hex");
        blobs.set(hash, bytes);
        return ok({ hash, sizeBytes: bytes.byteLength });
      },
    };
    const {
      captureWorkflowFilesSnapshot,
      captureWorkflowSnapshot,
      readSnapshotFiles,
      readWorkflowFolderFiles,
    } = await import("./snapshot.ts");
    const launched: Array<{
      instance: string;
      agent: string;
      codeSnapshot?: string | null;
    }> = [];
    const stopped: string[] = [];
    let checkErrors: string[] = [];
    const checkedCalls: Record<string, string>[] = [];
    let idSeq = 0;

    const svc = createWorkflowService({
      files: createWorkflowFiles(root),
      projects: {
        resolve: (ref) =>
          ref === "demo" || ref === PRJ
            ? Promise.resolve(ok({ id: PRJ as Id<"prj">, name: "demo" }))
            : Promise.resolve(
                err({ code: "not_found", message: "project not found" }),
              ),
        nameOf: () => Promise.resolve(ok("demo")),
      },
      turns: {
        stopSession: () => Promise.resolve(ok(undefined)),
        stepTurn: () => Promise.resolve(ok(null)),
        openOutgoingCalls: () => Promise.resolve(ok(0)),
      },
      remote: {
        computer: () => err({ code: "not_found", message: "no peer" }),
        workspace: () => err({ code: "not_found", message: "no ws" }),
        isPrivate: () => false,
        receivedStep: () => Promise.resolve(ok(null)),
        report: () => Promise.resolve(ok(undefined)),
        handOf: () => ok(null),
      },
      store: {
        create: (input) =>
          Promise.resolve(commands.create.handle(tx, machineCtx, input, {})),
        apply: (input, compare) =>
          Promise.resolve(
            commands.apply.handle(tx, machineCtx, input, compare),
          ),
        read: (instance) =>
          Promise.resolve(
            reads.read.handle(readSnapshot, machineCtx, { instance }),
          ),
        running: () => Promise.resolve(ok([])),
        upsertCheckpoint: (input) =>
          Promise.resolve(
            commands.upsertCheckpoint.handle(tx, machineCtx, input, {}),
          ),
      },
      snapshots: {
        capture: (project, workflow) =>
          captureWorkflowSnapshot(
            join(root, "projects", project, "workflows", workflow),
            blobStore,
          ),
        captureFiles: (files) => captureWorkflowFilesSnapshot(files, blobStore),
        readFiles: (manifest) =>
          readSnapshotFiles(manifest, {
            readBlob: async (hash) => {
              const found = blobs.get(hash);
              return found === undefined
                ? err({ code: "not_found", message: "missing blob" })
                : ok(found);
            },
          }),
        readFolderFiles: (project, workflow) =>
          readWorkflowFolderFiles(
            join(root, "projects", project, "workflows", workflow),
          ),
      },
      flowChecker: async (files) => {
        checkedCalls.push({ ...files });
        return ok({ errors: checkErrors, sdkVersion: "2.1.0" });
      },
      flows: {
        launch: async (start) => {
          launched.push({
            instance: start.instance,
            agent: start.agent,
            codeSnapshot: start.codeSnapshot,
          });
          return ok(undefined);
        },
        stop: async (instance) => {
          stopped.push(instance);
          return ok(undefined);
        },
      },
      ids: {
        newId: (prefix: string) =>
          `${prefix}_01hzzzzzzzzzzzzzzzzzzzzz${String(++idSeq).padStart(2, "0")}` as never,
      },
      logger: { info() {}, warn() {}, error() {}, debug() {} } as never,
    });

    const agentBy = {
      kind: "agent" as const,
      session: "ses_01hzzzzzzzzzzzzzzzzzzzzzz1" as Id<"ses">,
    };

    // 1) One-off flow type-check fails BEFORE approval is ever asked.
    checkErrors = ["flow.ts(1,1): error TS2304: Cannot find name 'oops'."];
    let approverCalls = 0;
    const badFlow = await svc.run(
      {
        project: "demo",
        name: "quick-flow",
        text: "run quick check",
        files: { "flow.ts": "oops();" },
      },
      agentBy,
      {
        approver: async () => {
          approverCalls += 1;
          return ok(undefined);
        },
      },
    );
    assert.ok(!badFlow.ok);
    assert.equal(badFlow.error.code, "invalid_input");
    assert.equal(approverCalls, 0);

    // 2) One-off flow rejected by person creates no instance.
    checkErrors = [];
    const rejected = await svc.run(
      {
        project: "demo",
        name: "quick-flow",
        text: "run quick check",
        files: { "flow.ts": 'import { report } from "@lophn/flow";' },
      },
      agentBy,
      {
        approver: async () =>
          err({ code: "forbidden", message: "person rejected" }),
      },
    );
    assert.ok(!rejected.ok);
    assert.equal(rejected.error.code, "forbidden");
    assert.equal(launched.length, 0);

    // 3) One-off flow approved starts with one_off=true and flow_agent persisted; resume(use_latest_code) is blocked.
    const seenApprovals: Array<{ mode: string; lines: readonly string[] }> = [];
    const oneOffFlow = await svc.run(
      {
        project: "demo",
        name: "quick-flow",
        agent: "custom-agent",
        text: "audit repo",
        files: {
          "flow.ts":
            'import { report } from "@lophn/flow";\nawait report({ step: "audit", text: "ok", next: "end" });',
        },
      },
      agentBy,
      {
        approver: async (req) => {
          seenApprovals.push({ mode: req.mode, lines: req.lines });
          return ok(undefined);
        },
      },
    );
    assert.ok(oneOffFlow.ok);
    assert.equal(oneOffFlow.value.instance.one_off, true);
    assert.equal(oneOffFlow.value.instance.flow_agent, "custom-agent");
    assert.deepStrictEqual(oneOffFlow.value.instance.started_by, agentBy);
    assert.equal(seenApprovals[0]?.mode, "one_off");
    assert.equal(launched.at(-1)?.agent, "custom-agent");

    // Mark blocked via program_exited so resume can be tested.
    await svc.programExited({
      instance: oneOffFlow.value.instance.id as Id<"wfi">,
      code: 1,
      stderr_tail: "boom",
    });
    const latestOnOneOff = await svc.resume({
      instance: oneOffFlow.value.instance.id as Id<"wfi">,
      use_latest_code: true,
    });
    assert.ok(!latestOnOneOff.ok);
    assert.equal(latestOnOneOff.error.code, "conflict");

    // 4) Override base flow at start without mutating base-flow/flow.ts on disk.
    const overriddenFlow = await svc.run(
      {
        workflow: "demo/base-flow",
        text: "custom run",
        override: {
          files: {
            "flow.ts":
              'import { report } from "@lophn/flow";\nawait report({ step: "run", text: "custom", next: "end" });',
          },
          agent: "alt-agent",
        },
      },
      agentBy,
      {
        approver: async (req) => {
          seenApprovals.push({ mode: req.mode, lines: req.lines });
          return ok(undefined);
        },
      },
    );
    assert.ok(overriddenFlow.ok);
    assert.equal(overriddenFlow.value.instance.overridden, true);
    assert.equal(overriddenFlow.value.instance.flow_agent, "alt-agent");
    assert.equal(
      await readFile(join(baseFlowDir, "flow.ts"), "utf8"),
      baseFlowCode,
    );

    // 5) Live override-code rejects while an agent checkpoint is started, succeeds when not in-flight, and leaves base folder untouched.
    await commands.upsertCheckpoint.handle(
      tx,
      machineCtx,
      {
        instance: overriddenFlow.value.instance.id,
        key: "step1/agent#1",
        kind: "agent",
        state: "started",
      },
      {},
    );
    const blockedOverride = await svc.overrideCode(
      {
        instance: overriddenFlow.value.instance.id,
        files: { "flow.ts": "// patched" },
      },
      agentBy,
      { approver: async () => ok(undefined) },
    );
    assert.ok(!blockedOverride.ok);
    assert.equal(blockedOverride.error.code, "conflict");

    await commands.upsertCheckpoint.handle(
      tx,
      machineCtx,
      {
        instance: overriddenFlow.value.instance.id,
        key: "step1/agent#1",
        kind: "agent",
        state: "completed",
      },
      {},
    );
    const patchedFlow = await svc.overrideCode(
      {
        instance: overriddenFlow.value.instance.id,
        files: {
          "flow.ts": "// patched v2",
          "extra.ts": "export const x = 1;",
        },
      },
      agentBy,
      {
        approver: async (req) => {
          seenApprovals.push({ mode: req.mode, lines: req.lines });
          return ok(undefined);
        },
      },
    );
    assert.ok(patchedFlow.ok);
    assert.ok(stopped.includes(overriddenFlow.value.instance.id));
    assert.equal(seenApprovals.at(-1)?.mode, "override_code");
    assert.equal(
      await readFile(join(baseFlowDir, "flow.ts"), "utf8"),
      baseFlowCode,
    );

    // 6) Override base YAML at start + live set_participant/remove_participant via edit + save as permanent workflow (stripping permission_mode).
    const overriddenYaml = await svc.run(
      {
        workflow: "demo/base-yaml",
        text: "custom yaml run",
        override: {
          participants: { reviewer: { agent: "claude" } },
          patch_steps: {
            first: { prompt: "overridden prompt", next: ["review"] },
          },
          add_steps: [
            {
              step: {
                name: "review",
                by: "reviewer",
                prompt: "review it",
                next: ["end"],
              },
              after: "first",
            },
          ],
        },
      },
      agentBy,
      { approver: async () => ok(undefined) },
    );
    assert.ok(overriddenYaml.ok);
    assert.equal(overriddenYaml.value.instance.overridden, true);
    assert.ok(routed.at(-1)?.body.includes("overridden prompt"));
    assert.equal(
      await readFile(join(baseYamlDir, "workflow.yaml"), "utf8"),
      baseYamlText,
    );

    const editedParticipant = await svc.edit(
      {
        instance: overriddenYaml.value.instance.id,
        op: "set_participant",
        key: "qa",
        participant: { agent: "codex" },
      },
      agentBy,
    );
    assert.ok(editedParticipant.ok);

    // Promote one-off flow and overridden YAML to permanent workflows.
    const savedFlow = await svc.save({
      instance: oneOffFlow.value.instance.id,
      name: "promoted-flow",
    });
    assert.ok(savedFlow.ok);
    assert.equal(savedFlow.value.kind, "flow");
    const promotedFlowYaml = await readFile(
      join(
        root,
        "projects",
        PRJ,
        "workflows",
        "promoted-flow",
        "workflow.yaml",
      ),
      "utf8",
    );
    assert.ok(promotedFlowYaml.includes("agent: custom-agent"));

    const savedYaml = await svc.save({
      instance: overriddenYaml.value.instance.id,
      name: "promoted-yaml",
    });
    assert.ok(savedYaml.ok);
    assert.equal(savedYaml.value.kind, "agent");
    const promotedYamlText = await readFile(
      join(
        root,
        "projects",
        PRJ,
        "workflows",
        "promoted-yaml",
        "workflow.yaml",
      ),
      "utf8",
    );
    assert.ok(promotedYamlText.includes("overridden prompt"));
    assert.ok(promotedYamlText.includes("qa:"));
    assert.ok(!promotedYamlText.includes("permission_mode"));

    // Conflict when overwrite is false; succeeds when overwrite is true.
    const conflictSave = await svc.save({
      instance: overriddenYaml.value.instance.id,
      name: "promoted-yaml",
    });
    assert.ok(!conflictSave.ok);
    assert.equal(conflictSave.error.code, "conflict");

    const overwriteSave = await svc.save({
      instance: overriddenYaml.value.instance.id,
      name: "promoted-yaml",
      overwrite: true,
    });
    assert.ok(overwriteSave.ok);

    // ListWorkflowInstances filters one_off cleanly.
    const oneOffList = reads.list.handle(readSnapshot, machineCtx, {
      project: PRJ as Id<"prj">,
      one_off: true,
    });
    assert.ok(oneOffList.ok);
    assert.equal(oneOffList.value.instances.length, 1);
    assert.equal(
      oneOffList.value.instances[0]!.id,
      oneOffFlow.value.instance.id,
    );
    assert.equal(oneOffList.value.instances[0]!.one_off, true);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
