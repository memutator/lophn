import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { manualClock } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { WorkflowOrigin } from "../../protocol/workflows/mod.ts";
import { countOpenOutgoingCalls, ROUTER_SCHEMA_STEPS } from "../router/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import {
  type AgentCallsSettledEvent,
  type AgentHandOffInput,
  type AgentHandOffResult,
  type AgentPrimitivePorts,
  type AgentPrimitiveTimers,
  type AgentReportEvent,
  type AgentStalledInfo,
  type AgentTurnEndedEvent,
  type AgentTurnStartedEvent,
  mapTurnOutcomeToReason,
  runAgentPrimitive,
} from "./agent-primitive.ts";

const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"prj">;
const WFI = "wfi_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"wfi">;
const SES_1 = "ses_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"ses">;
const SES_2 = "ses_01hzzzzzzzzzzzzzzzzzzzzzzb" as Id<"ses">;
const CAL_1 = "cal_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"cal">;
const START_MS = Date.parse("2026-11-23T12:00:00.000Z");

const ORIGIN: WorkflowOrigin = {
  project: PRJ,
  workflow: "deploy",
  instance: WFI,
  step: "review",
};

function createHarness(options?: {
  handOffResult?: AgentHandOffResult;
  openCalls?: number;
  running?: boolean;
}) {
  const clock = manualClock(START_MS);
  const scheduled = new Map<number, { dueMs: number; fn: () => void }>();
  let nextTimerId = 1;
  const timers: AgentPrimitiveTimers = {
    set(fn, ms) {
      const id = nextTimerId++;
      scheduled.set(id, { dueMs: clock.nowMs() + ms, fn });
      return id;
    },
    clear(handle) {
      scheduled.delete(handle as number);
    },
  };
  const advance = async (ms: number) => {
    clock.advance(ms);
    for (const [id, entry] of [...scheduled.entries()]) {
      if (entry.dueMs <= clock.nowMs()) {
        scheduled.delete(id);
        entry.fn();
      }
    }
    // async timer callback 정산을 기다린다.
    await new Promise((r) => setImmediate(r));
  };

  const turnEndedListeners = new Set<(e: AgentTurnEndedEvent) => void>();
  const turnStartedListeners = new Set<(e: AgentTurnStartedEvent) => void>();
  const callsSettledListeners = new Set<(e: AgentCallsSettledEvent) => void>();
  const reportListeners = new Set<(e: AgentReportEvent) => void>();

  const handOffCalls: AgentHandOffInput[] = [];
  const stoppedSessions: Id<"ses">[] = [];
  const stalledCalls: AgentStalledInfo[] = [];
  let openCalls = options?.openCalls ?? 0;
  let running = options?.running ?? false;

  const ports: AgentPrimitivePorts = {
    async handOff(input) {
      handOffCalls.push(input);
      return (
        options?.handOffResult ?? {
          ok: true,
          session: input.session ?? SES_1,
        }
      );
    },
    openOutgoingCalls: () => openCalls,
    subscribeTurnEnded(fn) {
      turnEndedListeners.add(fn);
      return () => turnEndedListeners.delete(fn);
    },
    subscribeTurnStarted(fn) {
      turnStartedListeners.add(fn);
      return () => turnStartedListeners.delete(fn);
    },
    subscribeCallsSettled(fn) {
      callsSettledListeners.add(fn);
      return () => callsSettledListeners.delete(fn);
    },
    subscribeReport(fn) {
      reportListeners.add(fn);
      return () => reportListeners.delete(fn);
    },
    isTurnRunning: () => running,
    stopSession(session) {
      stoppedSessions.push(session);
    },
    onStalled(info) {
      stalledCalls.push(info);
    },
    clock,
    timers,
    settlementGraceMs: 200,
  };

  const flush = () => new Promise((r) => setImmediate(r));

  return {
    ports,
    handOffCalls,
    stoppedSessions,
    stalledCalls,
    scheduled,
    setOpenCalls(n: number) {
      openCalls = n;
    },
    setRunning(v: boolean) {
      running = v;
    },
    emitTurnStarted(e: AgentTurnStartedEvent) {
      for (const fn of [...turnStartedListeners]) fn(e);
    },
    emitTurnEnded(e: AgentTurnEndedEvent) {
      for (const fn of [...turnEndedListeners]) fn(e);
    },
    emitCallsSettled(e: AgentCallsSettledEvent) {
      for (const fn of [...callsSettledListeners]) fn(e);
    },
    emitReport(e: AgentReportEvent) {
      for (const fn of [...reportListeners]) fn(e);
    },
    listenerCount() {
      return (
        turnEndedListeners.size +
        turnStartedListeners.size +
        callsSettledListeners.size +
        reportListeners.size
      );
    },
    advance,
    flush,
  };
}

test('mode: "turn" completes immediately with last assistant text when open outgoing calls is 0', async () => {
  const h = createHarness({ openCalls: 0 });
  const pending = runAgentPrimitive(h.ports, {
    agent: { agent: "reviewer" },
    prompt: "check this diff",
    origin: ORIGIN,
  });
  await h.flush();
  h.emitTurnEnded({
    session: SES_1,
    status: "completed",
    lastAssistantText: "Looks clean.",
  });
  const outcome = await pending;
  assert.deepStrictEqual(outcome, {
    ok: true,
    result: { summary: "Looks clean." },
  });
  assert.strictEqual(h.listenerCount(), 0);
  assert.strictEqual(h.scheduled.size, 0);
});

test('mode: "turn" waits while open outgoing agent_calls > 0 and returns follow-up turn answer', async () => {
  const h = createHarness({ openCalls: 1 });
  const pending = runAgentPrimitive(h.ports, {
    agent: { agent: "coordinator" },
    prompt: "delegate work to worker",
    origin: ORIGIN,
  });
  await h.flush();

  // 첫 turn은 worker에게 call을 보내고 끝난다 -> 아직 끝나면 안 된다.
  let resolved = false;
  void pending.then(() => {
    resolved = true;
  });
  h.emitTurnEnded({
    session: SES_1,
    status: "completed",
    lastAssistantText: "Waiting for worker...",
  });
  await h.flush();
  assert.strictEqual(resolved, false);

  // worker call이 정산되고 곧바로 후속 turn이 시작되면 긴 후속 turn 중에도 stall되지 않는다.
  h.setOpenCalls(0);
  h.emitCallsSettled({ session: SES_1, call: CAL_1, state: "done" });
  await h.flush();
  h.emitTurnStarted({ session: SES_1 });
  await h.advance(500);
  assert.strictEqual(resolved, false);

  // 후속 turn이 열린 call 0개로 끝나면 그 turn의 응답을 돌려준다.
  h.emitTurnEnded({
    session: SES_1,
    status: "completed",
    lastAssistantText: "Final synthesized answer.",
  });
  const outcome = await pending;
  assert.deepStrictEqual(outcome, {
    ok: true,
    result: { summary: "Final synthesized answer." },
  });
  assert.strictEqual(h.listenerCount(), 0);
});

test('mode: "turn" returns stalled with session when all open calls settle without a follow-up turn', async () => {
  const h = createHarness({ openCalls: 1 });
  const pending = runAgentPrimitive(h.ports, {
    agent: { agent: "coordinator" },
    prompt: "delegate work",
    origin: ORIGIN,
  });
  await h.flush();

  h.emitTurnEnded({
    session: SES_1,
    status: "completed",
    lastAssistantText: "Spawned worker",
  });
  await h.flush();

  // worker가 실패해 열린 call이 0이 되었지만 후속 turn이 열리지 않는다.
  h.setOpenCalls(0);
  h.emitCallsSettled({
    session: SES_1,
    call: CAL_1,
    state: "failed",
    failReason: "receiver_ended",
  });
  await h.flush();
  // grace window 전에는 아직 기다린다.
  await h.advance(100);
  assert.strictEqual(h.scheduled.size, 1);

  // grace window를 넘기면 영구 대기 없이 stalled로 닫힌다.
  await h.advance(100);
  const outcome = await pending;
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.reason, "stalled");
  assert.strictEqual(outcome.session, SES_1);
  assert.strictEqual(h.listenerCount(), 0);
});

test('mode: "turn" preserves exact failure reason and session without collapsing to model_error', async () => {
  for (const reason of ["unavailable", "model_error", "forbidden"] as const) {
    const h = createHarness();
    const pending = runAgentPrimitive(h.ports, {
      agent: { agent: "reviewer" },
      prompt: "run",
      origin: ORIGIN,
    });
    await h.flush();
    h.emitTurnEnded({
      session: SES_1,
      status: "failed",
      errorReason: reason,
      errorMessage: `failed: ${reason}`,
    });
    const outcome = await pending;
    assert.deepStrictEqual(outcome, {
      ok: false,
      reason,
      message: `failed: ${reason}`,
      session: SES_1,
    });
  }

  assert.strictEqual(
    mapTurnOutcomeToReason({ kind: "failed", reason: "target_unavailable" }),
    "unavailable",
  );
  assert.strictEqual(
    mapTurnOutcomeToReason(
      { kind: "failed", reason: "model_error" },
      "forbidden",
    ),
    "forbidden",
  );
  assert.strictEqual(
    mapTurnOutcomeToReason({ kind: "interrupted", reason: "restarted" }),
    "interrupted",
  );
});

test('mode: "report" resolves on explicit workflow.report and invokes onStalled at most once per attempt', async () => {
  const h = createHarness({ openCalls: 0 });
  const pending = runAgentPrimitive(h.ports, {
    agent: { agent: "implementer" },
    prompt: "implement and report",
    mode: "report",
    origin: ORIGIN,
  });
  await h.flush();

  // 명시적 report 없이 turn이 두 번 끝나도 onStalled는 attempt당 최대 1회만 호출된다.
  h.emitTurnEnded({
    session: SES_1,
    status: "completed",
    lastAssistantText: "forgot to call workflow.report",
  });
  await h.flush();
  h.emitTurnEnded({
    session: SES_1,
    status: "completed",
    lastAssistantText: "user chatted with agent",
  });
  await h.flush();
  assert.strictEqual(h.stalledCalls.length, 1);
  assert.strictEqual(h.stalledCalls[0]!.session, SES_1);
  assert.deepStrictEqual(h.stalledCalls[0]!.origin, ORIGIN);

  // 다른 step이나 다른 session의 report는 무시한다.
  h.emitReport({
    instance: WFI,
    step: "other-step",
    session: SES_1,
    summary: "wrong step",
  });
  h.emitReport({
    instance: WFI,
    step: "review",
    session: SES_2,
    summary: "wrong session",
  });
  await h.flush();

  // 일치하는 explicit report가 오면 refs·data를 그대로 싣고 성공한다.
  h.emitReport({
    instance: WFI,
    step: "review",
    session: SES_1,
    summary: "Implemented and verified",
    refs: ["docs/plan.md"],
    data: { passed: true },
  });
  const outcome = await pending;
  assert.deepStrictEqual(outcome, {
    ok: true,
    result: {
      summary: "Implemented and verified",
      refs: ["docs/plan.md"],
      data: { passed: true },
    },
  });
  assert.strictEqual(h.listenerCount(), 0);
});

test('mode: "report" with stalledResolves returns stalled outcome on first stall', async () => {
  const h = createHarness({ openCalls: 0 });
  const pending = runAgentPrimitive(h.ports, {
    agent: { agent: "implementer" },
    prompt: "implement",
    mode: "report",
    origin: ORIGIN,
    stalledResolves: true,
  });
  await h.flush();
  h.emitTurnEnded({
    session: SES_1,
    status: "completed",
    lastAssistantText: "done without report",
  });
  const outcome = await pending;
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.reason, "stalled");
  assert.strictEqual(outcome.session, SES_1);
  assert.strictEqual(h.stalledCalls.length, 1);
  assert.strictEqual(h.listenerCount(), 0);
});

test("AbortSignal cancels active turn, calls stopSession, cleans up listeners, and resolves cancelled", async () => {
  const h = createHarness({ openCalls: 1 });
  const ac = new AbortController();
  const pending = runAgentPrimitive(h.ports, {
    agent: { agent: "reviewer" },
    prompt: "long work",
    origin: ORIGIN,
    signal: ac.signal,
  });
  await h.flush();
  assert.ok(h.listenerCount() > 0);

  ac.abort("user cancelled step");
  const outcome = await pending;
  assert.deepStrictEqual(outcome, {
    ok: false,
    reason: "cancelled",
    message: "user cancelled step",
    session: SES_1,
  });
  assert.deepStrictEqual(h.stoppedSessions, [SES_1]);
  assert.strictEqual(h.listenerCount(), 0);
  assert.strictEqual(h.scheduled.size, 0);
});

test('session: "same" reuses existing session id and refreshes workflow_origin', async () => {
  const h = createHarness({ openCalls: 0 });
  const nextOrigin: WorkflowOrigin = {
    project: PRJ,
    workflow: "deploy",
    instance: WFI,
    step: "verify",
  };
  const pending = runAgentPrimitive(h.ports, {
    agent: { agent: "reviewer" },
    prompt: "continue on next step",
    session: "same",
    sameSession: SES_2,
    origin: nextOrigin,
  });
  await h.flush();
  assert.strictEqual(h.handOffCalls.length, 1);
  assert.strictEqual(h.handOffCalls[0]!.session, SES_2);
  assert.deepStrictEqual(h.handOffCalls[0]!.origin, nextOrigin);

  h.emitTurnEnded({
    session: SES_2,
    status: "completed",
    lastAssistantText: "Verified on reused session.",
  });
  const outcome = await pending;
  assert.deepStrictEqual(outcome, {
    ok: true,
    result: { summary: "Verified on reused session." },
  });
});

test("on: <machine> delegates via handOffRemote and supports AbortSignal cancellation", async () => {
  const h = createHarness();
  let remoteCalled = false;
  let releaseRemote!: (v: { ok: true; result: { summary: string } }) => void;
  h.ports.handOffRemote = (input) => {
    remoteCalled = true;
    assert.strictEqual(input.on, "gpu-box");
    assert.deepStrictEqual(input.origin, ORIGIN);
    return new Promise((resolve) => {
      releaseRemote = resolve;
    });
  };
  const ac = new AbortController();
  const pending = runAgentPrimitive(h.ports, {
    agent: { agent: "trainer" },
    prompt: "train model",
    on: "gpu-box",
    origin: ORIGIN,
    signal: ac.signal,
  });
  assert.strictEqual(remoteCalled, true);
  ac.abort("cancel remote");
  const outcome = await pending;
  assert.deepStrictEqual(outcome, {
    ok: false,
    reason: "cancelled",
    message: "cancel remote",
  });
  // 뒤늦은 원격 완료가 오류를 던지지 않는다.
  releaseRemote({ ok: true, result: { summary: "late" } });
});

test("countOpenOutgoingCalls counts accepted non-ask outgoing calls for a session", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of ROUTER_SCHEMA_STEPS) db.exec(step.sql);
    const sql = createSql(db, () => true);
    const at = "2026-11-23T12:00:00.000Z";
    // 열린 일반 outgoing call
    sql.run(
      `insert into agent_calls (call, from_session, "to", receiver_session, reply, state, fail_reason, dedup, consumed, unattended, ask, created_at, state_at)
       values ('cal_1', ?, '{}', 'ses_r', 'result', 'accepted', null, null, 0, 1, null, ?, ?)`,
      [SES_1, at, at],
    );
    // 닫힌 outgoing call (제외)
    sql.run(
      `insert into agent_calls (call, from_session, "to", receiver_session, reply, state, fail_reason, dedup, consumed, unattended, ask, created_at, state_at)
       values ('cal_2', ?, '{}', 'ses_r', 'result', 'done', null, null, 1, 1, null, ?, ?)`,
      [SES_1, at, at],
    );
    // ask call (제외)
    sql.run(
      `insert into agent_calls (call, from_session, "to", receiver_session, reply, state, fail_reason, dedup, consumed, unattended, ask, created_at, state_at)
       values ('cal_3', ?, '{}', 'ses_p', 'result', 'accepted', null, null, 0, 1, 'approval', ?, ?)`,
      [SES_1, at, at],
    );
    assert.strictEqual(countOpenOutgoingCalls({ sql }, SES_1), 1);
    assert.strictEqual(countOpenOutgoingCalls({ sql }, SES_2), 0);
  } finally {
    db.close();
  }
});
