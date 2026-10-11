import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { err, manualClock, ok, type Result } from "../../../base/mod.ts";
import type { ModelOutcome } from "../../../contracts/lophn-agent/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
  type WirePacker,
} from "../prompt-assemble/mod.ts";
import {
  type FinishRequest,
  type LoopDeps,
  type LoopEnd,
  type ModelAttempt,
  type ModelCallRequest,
  type ResumeState,
  type RunInput,
  type RunPorts,
  startRunLoop,
  type ToolCallRequest,
  type ToolDone,
} from "../run-loop/mod.ts";
import {
  advanceElapsed,
  boundaryOf,
  confirmedFactsOf,
  planRecovery,
  type RebuildModel,
  rebuildResume,
  type RebuildTool,
  recoverCompactionSummaries,
  type SummaryCallRecord,
  type ToolView,
} from "./mod.ts";

// 중단 뒤 복구(lophn-agent/harness/waiting-and-recovery R8–R10, R12). 경계·이력 재구성·계획은 순수
// 함수이고, 이어 가는 loop는 fake port로 본다. 실제 core를 띄워 runtime을 멈추고 다시 띄우는 흐름은
// apps/core/run-recovery_test.ts가 본다.

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const NOW = "2026-10-07T00:10:00.000Z";
const START = "2026-10-07T00:00:00.000Z";
const COMPLETE: ModelOutcome = {
  kind: "complete",
  code: null,
  retry_at: null,
  finish_reason: "end_turn",
  http_status: 200,
  provider_code: null,
};
const ELAPSED = { active_ms: 1000, stall_ms: 500, checkpoint_at: START };

function mcl(n: number): string {
  return `mcl_01arz3ndektsv4rrffq69g5f${n.toString().padStart(2, "0")}`;
}
function tcl(n: number): string {
  return `tcl_01arz3ndektsv4rrffq69g5f${n.toString().padStart(2, "0")}`;
}

function tool(
  n: number,
  model: number,
  key: string,
  over: Partial<RebuildTool> = {},
): RebuildTool {
  return {
    id: tcl(n),
    model_call: mcl(model),
    response_key: key,
    response_order: 0,
    attempt: 0,
    effect: "write",
    extension: null,
    state: "finished",
    outcome_kind: "success",
    tool: "doc.write",
    code: "ok",
    result: {
      status: "success",
      summary: `done ${key}`,
      content: { key },
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    },
    ...over,
  };
}

const THREE = {
  text: "I will do three things.",
  tools: [
    { id: "a", name: "doc.write", args: '{"n":1}' },
    { id: "b", name: "doc.write", args: '{"n":2}' },
    { id: "c", name: "doc.write", args: '{"n":3}' },
  ],
};

function model(
  n: number,
  body: RebuildModel["body"],
  over: Partial<RebuildModel> = {},
): RebuildModel {
  return {
    id: mcl(n),
    attempt_order: n,
    retry_of: null,
    outcome: COMPLETE,
    body,
    steering: [],
    ...over,
  };
}

const packer: WirePacker = (request) => ({
  body: {
    tools: anthropicTools(request),
    system: anthropicSystem(request),
    messages: request.messages,
  },
  opaque_bytes: 0,
});

// 이어 가는 loop. model은 script, tool은 호출을 기록한다.
function rig(
  resume: ResumeState,
  scripted: {
    text?: string;
    calls?: ModelAttempt["toolCalls"];
    fail?: boolean;
  }[],
) {
  const clock = manualClock(Date.parse(NOW));
  const requests: ModelCallRequest[] = [];
  const attempts: ToolCallRequest[] = [];
  const resumed: { call: ToolCallRequest; id: string }[] = [];
  const finishes: FinishRequest[] = [];
  const answers: string[] = [];
  const waits: number[] = [];
  let next = 100;
  const done = (id: string, status: ToolDone["status"]): ToolDone => ({
    kind: "done",
    tool_call: id,
    status,
    code: "ok",
    result: {
      status,
      summary: `ran ${id}`,
      content: null,
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    },
  });
  const ports: RunPorts = {
    stop: () => Promise.resolve({ stopped: false }),
    inputs: () => Promise.resolve(ok({ request: "REQUEST", steering: [] })),
    context: () =>
      Promise.resolve(ok({
        product: { instructions: "PRODUCT" },
        role: { instructions: "ROLE", preset_prompt: null },
        tools: [{
          name: "doc.write",
          description: "write",
          input_schema: { type: "object" },
        }],
        work: {
          role: "lophn",
          session: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
          scope: { kind: "all", id: null },
        },
        attachments: [],
        purpose: null,
        run_facts: null,
        continuation_summary: null,
        sources: [],
        skills: [],
        timezone: null,
        limits: {
          context_limit: 200000,
          input_limit: 150000,
          output_limit: 32000,
        },
        reserved_output: 8000,
      })),
    view: () =>
      Promise.resolve(ok({
        availability: "disconnected",
        reason: "no window",
      } as never)),
    model: {
      pack: packer,
      available: () => Promise.resolve(true),
      call(request): Promise<Result<ModelAttempt>> {
        requests.push(request);
        const step = scripted.shift();
        assert(step !== undefined, "model script ran out");
        if (step.fail) {
          return Promise.resolve(
            err({
              code: "unavailable",
              message: "the response was not stored",
            }),
          );
        }
        next += 1;
        return Promise.resolve(ok({
          id: mcl(next),
          outcome: COMPLETE,
          text: step.text ?? "",
          toolCalls: step.calls ?? [],
        }));
      },
    },
    tools: {
      info: () => ({ effect: "write", idempotent: false, server: null }),
      attempt(request) {
        attempts.push(request);
        next += 1;
        return Promise.resolve(done(tcl(next), "success"));
      },
      resume(request, id) {
        resumed.push({ call: request, id });
        return Promise.resolve(done(id, "success"));
      },
      close: (_request, why) => Promise.resolve(done(tcl(++next), why.status)),
    },
    checkpoint: () => Promise.resolve(),
    answer(text) {
      answers.push(text);
      return Promise.resolve(ok(undefined));
    },
    wait: () => Promise.resolve(ok(undefined)),
    finish(request) {
      finishes.push(request);
      return Promise.resolve(ok({ finished: true as const }));
    },
  };
  const deps: LoopDeps = {
    clock,
    wait(ms) {
      waits.push(ms);
      clock.advance(ms);
      return Promise.resolve("elapsed");
    },
    deadline: () => new Promise(() => {}),
    random: () => 0.5,
    instructions: {
      files: {
        registered: () => Promise.resolve(ok(null)),
        attached: () =>
          Promise.resolve(err({ code: "not_found", message: "none" })),
        projectOf: () => Promise.resolve(ok(null)),
      },
      redact: (text) => text,
    },
    ports,
  };
  const input: RunInput = {
    run: RUN,
    session: null,
    limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
    elapsed: ELAPSED,
    attempts: 1,
    resume,
  };
  return {
    requests,
    attempts,
    resumed,
    finishes,
    answers,
    waits,
    run: (): Promise<LoopEnd> => startRunLoop(deps, input).done,
  };
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R8: 순차 세 call 중 둘째 결과 뒤에 끊기면 앞 두 call은 다시 실행하지 않고 셋째부터 잇는다", async () => {
  // 응답 하나에 쓰기 call이 셋이고 앞 둘의 결과가 확정됐다. 응답은 다시 받지 않는다.
  const resume = await rebuildResume({
    collectedAt: NOW,
    models: [model(1, THREE)],
    tools: [tool(1, 1, "a"), tool(2, 1, "b")],
    executing: new Set(),
  });
  assertEquals(resume.pending?.confirmed.map((item) => item.key), ["a", "b"]);
  assertEquals(resume.history, []);
  const r = rig(resume, [{ text: "All three are done." }]);
  const end = await r.run();
  assertEquals(end, {
    kind: "finished",
    outcome: { kind: "completed", reason: "answer_completed" },
  });
  // 셋째 call만 진입한다. 첫 model 요청은 이미 받은 응답을 다시 부르지 않고 그 다음 판단이다.
  assertEquals(r.attempts.map((call) => call.key), ["c"]);
  assertEquals(r.requests.length, 1);
  const text = JSON.stringify(r.requests[0].assembly.request.messages);
  for (const key of ["a", "b", "c"]) assertStringIncludes(text, `"${key}"`);
  assertStringIncludes(text, "done a");
  assertStringIncludes(text, "done b");
  assertEquals(r.answers, ["All three are done."]);
  // 앞 두 call의 쓰기 변경은 이어 가는 run의 확정 사실에 한 번씩만 있다.
  assertEquals(r.finishes[0].facts.changes.length, 3);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R8: 모든 call이 확정된 응답은 model을 다시 부르지 않고 결과만 잇고 다음 판단으로 간다", async () => {
  const resume = await rebuildResume({
    collectedAt: NOW,
    models: [model(1, THREE)],
    tools: [tool(1, 1, "a"), tool(2, 1, "b"), tool(3, 1, "c")],
    executing: new Set(),
  });
  const r = rig(resume, [{ text: "Finished." }]);
  await r.run();
  assertEquals(r.attempts, []);
  assertEquals(r.requests.length, 1);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R8: 확정한 응답과 결과로 이력을 다시 만들고 사실은 처리를 마친 응답만 센다", async () => {
  const resume = await rebuildResume({
    collectedAt: NOW,
    models: [
      model(1, {
        text: "first",
        tools: [{ id: "x", name: "doc.write", args: "{}" }],
      }, { steering: ["CHANGE COURSE"] }),
      model(2, THREE),
    ],
    tools: [
      tool(1, 1, "x"),
      tool(2, 2, "a", { effect: "write" }),
    ],
    executing: new Set(),
  });
  assertEquals(resume.history.map((message) => message.role), [
    "user",
    "assistant",
    "user",
  ]);
  assertEquals(resume.history[0].parts[0], {
    kind: "text",
    text: "CHANGE COURSE",
  });
  // 남은 응답의 확정 결과(a)는 loop가 이어 가며 센다. 이미 처리한 응답의 변경만 여기 있다.
  assertEquals(resume.facts.changes, [tcl(1)]);
  assertEquals(resume.pending?.confirmed.map((item) => item.key), ["a"]);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R8: 도구 없는 마지막 완전 응답은 다시 부르지 않고 답 기록과 종료부터 잇는다", async () => {
  const resume = await rebuildResume({
    collectedAt: NOW,
    models: [model(1, { text: "The answer.", tools: [] })],
    tools: [],
    executing: new Set(),
  });
  const r = rig(resume, []);
  const end = await r.run();
  assertEquals(end.kind, "finished");
  assertEquals(r.requests.length, 0);
  assertEquals(r.answers, ["The answer."]);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R8: 응답 저장에 실패하면 완료로 가정하지 않고 tool과 다음 판단을 시작하지 않는다", async () => {
  const resume: ResumeState = {
    history: [],
    facts: { changes: [], unexecuted: [], unknown_effects: [] },
    pending: null,
    retry: null,
  };
  const r = rig(resume, [{ fail: true }, {
    text: "never reached",
    calls: [{ id: "a", name: "doc.write", args: "{}" }],
  }]);
  const end = await r.run();
  assertEquals(end, {
    kind: "finished",
    outcome: { kind: "failed", reason: "configuration_unavailable" },
  });
  assertEquals(r.requests.length, 1);
  assertEquals(r.attempts, []);
  assertEquals(r.answers, []);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R10: 사람의 허락으로 진입이 기록된 call은 판정 없이 한 번 실행하고 다른 call을 다시 실행하지 않는다", async () => {
  const resume = await rebuildResume({
    collectedAt: NOW,
    models: [model(1, THREE)],
    tools: [
      tool(1, 1, "a"),
      tool(2, 1, "b", {
        state: "started",
        outcome_kind: null,
        code: null,
        result: null,
      }),
    ],
    executing: new Set([tcl(2)]),
  });
  assertEquals(resume.pending?.started, { b: tcl(2) });
  const r = rig(resume, [{ text: "done" }]);
  await r.run();
  // b는 기록된 진입을 그대로 실행하고(resume), c만 새로 판정해 진입한다. a는 다시 부르지 않는다.
  assertEquals(r.resumed.map((item) => item.call.key), ["b"]);
  assertEquals(r.attempts.map((call) => call.key), ["c"]);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R7: 일시 실패 뒤 재시작은 남은 대기만 기다리고 쓴 횟수를 잇는다", async () => {
  const retryAt = "2026-10-07T00:10:07.000Z";
  const resume = await rebuildResume({
    collectedAt: NOW,
    models: [
      model(1, null, {
        outcome: {
          kind: "failed",
          code: "temporary",
          retry_at: retryAt,
          finish_reason: null,
        },
      }),
    ],
    tools: [],
    executing: new Set(),
  });
  assertEquals(resume.retry, {
    previous: mcl(1),
    retries: 1,
    retry_at: retryAt,
  });
  const r = rig(resume, [{ text: "ok now" }]);
  await r.run();
  // 예정 시각 7초 뒤까지 남은 간격만 기다린다. 처음부터 다시 재지 않는다.
  assertEquals(r.waits, [7000]);
  assertEquals(r.requests[0].kind, "retry");
  assertEquals(r.requests[0].retry_of, mcl(1));
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R7: 재시도를 다 쓴 일시 실패는 한도를 새로 받지 않고 같은 이유로 끝낸다", async () => {
  const failed = (n: number, of: number | null): RebuildModel =>
    model(n, null, {
      retry_of: of === null ? null : mcl(of),
      outcome: {
        kind: "failed",
        code: "temporary",
        retry_at: null,
        finish_reason: null,
      },
    });
  const resume = await rebuildResume({
    collectedAt: NOW,
    models: [failed(1, null), failed(2, 1)],
    tools: [],
    executing: new Set(),
  });
  assertEquals(resume.retry?.retries, 2);
  const r = rig(resume, []);
  const end = await r.run();
  assertEquals(end, {
    kind: "finished",
    outcome: { kind: "failed", reason: "model_error" },
  });
  assertEquals(r.requests.length, 0);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R10: 경계는 시작만 있는 호출이 먼저고 쓰기·external·model·마지막 응답 순이다", () => {
  const write: ToolView = {
    id: tcl(1),
    model_call: mcl(1),
    response_key: "a",
    response_order: 0,
    attempt: 0,
    effect: "write",
    extension: null,
    state: "started",
    outcome_kind: null,
  };
  const run = { state: "running" as const };
  const done = {
    id: mcl(1),
    attempt_order: 1,
    state: "finished" as const,
    outcome_kind: "complete",
  };
  const open = {
    id: mcl(2),
    attempt_order: 2,
    state: "started" as const,
    outcome_kind: null,
  };
  assertEquals(boundaryOf(run, [done], [write]), {
    boundary: "ledger_write",
    call: tcl(1),
  });
  assertEquals(
    boundaryOf(run, [done], [{ ...write, extension: { server_name: "mail" } }]),
    { boundary: "outside_call", call: tcl(1) },
  );
  assertEquals(
    boundaryOf(run, [done], [{ ...write, effect: "external" }]).boundary,
    "outside_call",
  );
  assertEquals(boundaryOf(run, [done, open], []), {
    boundary: "model_started",
    call: mcl(2),
  });
  assertEquals(boundaryOf(run, [done], []), {
    boundary: "model_finished",
    call: mcl(1),
  });
  assertEquals(boundaryOf(run, [], []), { boundary: "accepted", call: null });
  assertEquals(
    boundaryOf({ state: "waiting_user" }, [done], []).boundary,
    "waiting",
  );
  assertEquals(
    boundaryOf({ state: "finished" }, [done], []).boundary,
    "finished",
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R10: 확정 사실은 변경·미실행·불명확 효과를 구별하고 마지막 시도만 센다", () => {
  const base = (n: number, kind: string, attempt = 0): ToolView => ({
    id: tcl(n),
    model_call: mcl(1),
    response_key: `k${n}`,
    response_order: n,
    attempt,
    effect: "write",
    extension: null,
    state: "finished",
    outcome_kind: kind,
  });
  const facts = confirmedFactsOf([
    base(1, "success"),
    base(2, "not_executed"),
    base(3, "uncertain"),
    { ...base(4, "failure"), response_key: "k3", attempt: 0 },
    { ...base(5, "success"), response_key: "k3", attempt: 1 },
    { ...base(6, "success"), effect: "read" },
    { ...base(7, "success"), state: "started", outcome_kind: null },
  ]);
  assertEquals(facts, {
    changes: [tcl(1), tcl(5)],
    unexecuted: [tcl(2)],
    unknown_effects: [],
  });
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R9: 복구 계획은 끝난 run·시작 전 run·사람 기다림을 건드리지 않고 멈춘 assignment를 풀지 않는다", () => {
  const live = {
    run: { state: "running" as const, started_at: START, elapsed: ELAPSED },
    models: [],
    tools: [],
    now: NOW,
  };
  assertEquals(
    planRecovery({
      ...live,
      run: { ...live.run, state: "finished" },
      assignment: "enabled",
    }),
    { kind: "skip", why: "finished" },
  );
  assertEquals(
    planRecovery({
      ...live,
      run: { ...live.run, state: "accepted" },
      assignment: "enabled",
    }),
    { kind: "skip", why: "accepted" },
  );
  assertEquals(
    planRecovery({
      ...live,
      run: { ...live.run, state: "waiting_user" },
      assignment: "enabled",
    }),
    { kind: "skip", why: "waiting" },
  );
  assertEquals(planRecovery({ ...live, assignment: "paused" }), {
    kind: "stop",
    reason: "assignment_paused",
  });
  for (const assignment of ["withdrawn", undefined] as const) {
    assertEquals(planRecovery({ ...live, assignment }), {
      kind: "stop",
      reason: "assignment_withdrawn",
    });
  }
  const plan = planRecovery({ ...live, assignment: "enabled" });
  assert(plan.kind === "resume");
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R9: 중단 시간은 active와 stall에 모두 더하고 기준 시각이 없거나 시계가 거꾸로 가면 clock_uncertain이다", () => {
  const gap = 600_000;
  assertEquals(advanceElapsed(ELAPSED, START, NOW), {
    active_ms: 1000 + gap,
    stall_ms: 500 + gap,
    checkpoint_at: NOW,
  });
  // checkpoint가 없으면 시작 시각이 기준이다.
  assertEquals(
    advanceElapsed({ ...ELAPSED, checkpoint_at: null }, START, NOW)?.active_ms,
    1000 + gap,
  );
  assertEquals(
    advanceElapsed({ ...ELAPSED, checkpoint_at: null }, null, NOW),
    null,
  );
  assertEquals(
    advanceElapsed(ELAPSED, START, "2026-09-01T00:00:00.000Z"),
    null,
  );
  const plan = planRecovery({
    run: { state: "running", started_at: START, elapsed: ELAPSED },
    assignment: "enabled",
    models: [],
    tools: [],
    now: "2026-09-01T00:00:00.000Z",
  });
  assertEquals(plan, { kind: "finish", reason: "clock_uncertain" });
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R12: 압축 summary는 cache 없이 같은 run의 완성 호출과 원문 구간으로만 다시 만들고 이어가기 summary와 합치지 않는다", () => {
  const parts = {
    purpose: "p",
    decisions_constraints: "d",
    progress_evidence: "e",
    incomplete: "i",
    failures_next: "f",
    estimations_uncertainty: "u",
  };
  const call = (
    id: string,
    over: Partial<SummaryCallRecord> = {},
  ): SummaryCallRecord => ({
    call: id,
    purpose: "conversation_compression",
    run: RUN,
    session: null,
    outcome_kind: "complete",
    output_hash: "a".repeat(64),
    text: "summary",
    range: { from_seq: 10n, through_seq: 20n },
    protected_kept: true,
    created_at: NOW,
    parts,
    ...over,
  });
  const recovered = recoverCompactionSummaries(RUN, [
    call(mcl(2), { range: { from_seq: 21n, through_seq: 30n } }),
    call(mcl(1)),
    // 완성이 아닌 호출, 보호 원문을 지키지 못한 호출, 구간을 모르는 호출은 쓰지 않는다.
    call(mcl(3), { outcome_kind: "partial" }),
    call(mcl(4), { protected_kept: false }),
    call(mcl(5), { range: null }),
    call(mcl(6), { text: "  " }),
    // 다른 run의 압축과 세션 이어가기 summary는 이 run의 압축이 아니다.
    call(mcl(7), { run: "run_01arz3ndektsv4rrffq69g5faa" }),
    call(mcl(8), { run: null, session: "ses_01arz3ndektsv4rrffq69g5fav" }),
    call(mcl(9), { purpose: "title_summary" }),
  ]);
  assertEquals(recovered.map((ref) => ref.summary_call), [mcl(1), mcl(2)]);
  for (const ref of recovered) {
    assertEquals(ref.kind, "compaction");
    assertEquals(ref.run, RUN);
    assertEquals(ref.session, null);
  }
});
