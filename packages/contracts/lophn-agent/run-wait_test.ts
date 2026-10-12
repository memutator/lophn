import { assert } from "@std/assert";
import { INITIAL_RUN_ELAPSED } from "./run-values.ts";
import {
  recoverRun,
  recoveryBasisSchema,
  resolveRunWait,
  runResumed,
  submittedWaitRequestSchema,
  waitResolutionSchema,
  waitRun,
  waitRunInputSchema,
} from "./run-wait.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const run = `run_${suffix}`;
const otherRun = "run_01arz3ndektsv4rrffq69g5faw";
const group = `qgr_${suffix}`;
const question = `qst_${suffix}`;
const approval = `apr_${suffix}`;
const call = `tcl_${suffix}`;
const hash = "c".repeat(64);
const questionInput = {
  id: group,
  run,
  session: null,
  expires_at: null,
  questions: [{
    id: question,
    prompt: "Which one?",
    reason: "Both are fine.",
    options: [],
    recommendation: null,
  }],
};
// 요청은 글을 값으로 싣고 대기 결과는 저장된 질문(blob hash)을 돌려준다(Q38).
const storedQuestion = {
  id: group,
  run,
  session: null,
  expires_at: null,
  questions: [{
    id: question,
    group,
    position: 1,
    prompt_blob: hash,
    reason_blob: hash,
    options: [],
    recommendation: null,
  }],
};
// 승인 요청도 설명 글을 값으로 싣고 대기 결과는 저장된 요청(blob hash)을 돌려준다.
const approvalInput = {
  id: approval,
  run,
  requester: "machine",
  reason: "Save a version.",
  expires_at: null,
  effect: {
    changes: "One version is added.",
    external: null,
    reversible: true,
    reversibility: "The version can be removed.",
  },
  action: {
    concern: "documents/versions",
    command: "save_version",
    caller: "machine",
    targets: [`doc_${suffix}`],
    input: { kind: "inline", value: {} },
    input_hash: hash,
    comparison: {},
    binding_hash: hash,
  },
};
const storedApproval = {
  id: approval,
  run,
  requester: "machine",
  reason_blob: hash,
  expires_at: null,
  effect: {
    changes_blob: hash,
    external_blob: null,
    reversible: true,
    reversibility_blob: hash,
  },
  action: approvalInput.action,
};
const resolution = {
  run,
  request: group,
  decision_seq: "4",
  tool_call: null,
  result: "resumed",
  reason: "question_answered",
};
const recovery = {
  run,
  boundary: "finished",
  basis_seq: "9",
  call: null,
  confirmed_results: [],
  elapsed: { ...INITIAL_RUN_ELAPSED, active_ms: 10 },
  resolution: "audit_only",
  reason: "late_result",
};

Deno.test("lophn-agent/harness/waiting-and-recovery#R1: WaitRun carries exact new owner inputs and local run/call coupling", () => {
  const request = { kind: "question", input: questionInput };
  assert(submittedWaitRequestSchema.safeParse(request).success);
  assert(waitRunInputSchema.safeParse({ run, request, call: null }).success);
  assert(waitRunInputSchema.safeParse({ run, request, call }).success);
  assert(
    waitRunInputSchema.safeParse({
      run,
      request: { kind: "approval", input: approvalInput, tool_call: call },
      call,
    }).success,
  );
  for (
    const value of [
      { run: otherRun, request, call: null },
      {
        run,
        request: { kind: "approval", input: approvalInput, tool_call: call },
        call: null,
      },
      { run, request: { ...request, body: hash }, call: null },
      {
        run,
        request: {
          kind: "question",
          question: group,
          command: "create_question_group",
          body: hash,
          prepared: [],
        },
        call: null,
      },
    ]
  ) assert(!waitRunInputSchema.safeParse(value).success);
  const output = {
    run,
    state: "waiting_user",
    state_seq: "3",
    waiting_on: group,
    request: {
      ...request,
      future: true,
      input: { ...storedQuestion, future: true },
    },
    future: true,
  };
  assert(waitRun.output.safeParse(output).success);
  assert(
    !waitRun.output.safeParse({ ...output, waiting_on: approval }).success,
  );
  assert(!waitRun.output.safeParse({ ...output, run: otherRun }).success);
  assert(
    waitRun.output.safeParse({
      ...output,
      waiting_on: approval,
      request: {
        kind: "approval",
        tool_call: call,
        input: {
          ...storedApproval,
          future: true,
          effect: { ...storedApproval.effect, future: true },
          action: {
            ...storedApproval.action,
            future: true,
            input: { ...storedApproval.action.input, future: true },
          },
        },
      },
    }).success,
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R3: resolution results cannot turn a question into a call or an approval into an answer", () => {
  assert(waitResolutionSchema.safeParse(resolution).success);
  for (const result of ["call_started", "call_not_executed"]) {
    assert(!waitResolutionSchema.safeParse({ ...resolution, result }).success);
  }
  for (
    const result of ["call_started", "call_not_executed", "ignored_finished"]
  ) {
    assert(
      waitResolutionSchema.safeParse({
        ...resolution,
        request: approval,
        tool_call: call,
        result,
      }).success,
    );
    assert(
      !waitResolutionSchema.safeParse({
        ...resolution,
        request: approval,
        result,
      }).success,
    );
  }
  assert(
    !waitResolutionSchema.safeParse({
      ...resolution,
      request: approval,
      tool_call: call,
    }).success,
  );
  assert(
    !waitResolutionSchema.safeParse({
      ...resolution,
      reason: "raw error detail",
    }).success,
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R5: late finished approval preserves its fixed call and output outcome is additive", () => {
  const output = {
    run,
    state: "finished",
    state_seq: "5",
    resolution: {
      ...resolution,
      request: approval,
      tool_call: call,
      result: "ignored_finished",
      future: true,
    },
    outcome: { kind: "stopped", reason: "user_stopped", future: true },
    future: true,
  };
  assert(resolveRunWait.output.safeParse(output).success);
  assert(
    !resolveRunWait.output.safeParse({ ...output, state: "running" }).success,
  );
  assert(
    !resolveRunWait.output.safeParse({ ...output, run: otherRun }).success,
  );
  assert(
    resolveRunWait.output.safeParse({
      ...output,
      resolution: {
        ...resolution,
        result: "stopped_no_answer",
      },
      outcome: { kind: "stopped", reason: "no_answer" },
    }).success,
  );
  assert(!resolveRunWait.output.safeParse({ ...output, resolution }).success);
  assert(
    resolveRunWait.output.safeParse({
      ...output,
      state: "running",
      resolution,
      outcome: null,
    }).success,
  );
  const event = {
    request: group,
    decision_seq: "4",
    resolution: { ...resolution, future: true },
    future: true,
  };
  assert(runResumed.payload.safeParse(event).success);
  assert(
    !runResumed.payload.safeParse({ ...event, request: approval }).success,
  );
  assert(
    !runResumed.payload.safeParse({ ...event, decision_seq: "5" }).success,
  );
  assert(
    !runResumed.payload.safeParse({
      ...event,
      resolution: { ...resolution, result: "ignored_finished" },
    }).success,
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R6: wait contracts expose a fixed request and safe reason, not invented countdowns", () => {
  assert(waitResolutionSchema.safeParse(resolution).success);
  assert(
    !waitResolutionSchema.safeParse({ ...resolution, countdown: 10 }).success,
  );
  assert(
    !waitRunInputSchema.safeParse({
      run,
      request: { kind: "question", input: questionInput },
      call: null,
      retry_count: 1,
    }).success,
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R7: recovery transports persisted elapsed values without reset flags", () => {
  assert(recoveryBasisSchema.safeParse(recovery).success);
  assert(
    !recoveryBasisSchema.safeParse({ ...recovery, reset_limits: true }).success,
  );
  assert(
    !recoveryBasisSchema.safeParse({
      ...recovery,
      elapsed: { ...recovery.elapsed, active_ms: -1 },
    }).success,
  );
  assert(
    recoveryBasisSchema.safeParse({
      ...recovery,
      boundary: "accepted",
      resolution: "resume",
      elapsed: INITIAL_RUN_ELAPSED,
    }).success,
  );
  assert(
    !recoveryBasisSchema.safeParse({
      ...recovery,
      boundary: "accepted",
      resolution: "finish",
    }).success,
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R10: recovery call prefixes and terminal audit-only boundary are exact", () => {
  for (
    const boundary of [
      "model_started",
      "model_finished",
      "ledger_write",
      "outside_call",
    ]
  ) {
    const expected = boundary.startsWith("model") ? `mcl_${suffix}` : call;
    const wrong = boundary.startsWith("model") ? call : `mcl_${suffix}`;
    assert(
      recoveryBasisSchema.safeParse({
        ...recovery,
        boundary,
        resolution: "resume",
        call: expected,
      }).success,
    );
    for (const call of [null, wrong]) {
      assert(
        !recoveryBasisSchema.safeParse({
          ...recovery,
          boundary,
          resolution: "resume",
          call,
        }).success,
      );
    }
  }
  assert(
    !recoveryBasisSchema.safeParse({ ...recovery, resolution: "resume" })
      .success,
  );
  assert(
    recoverRun.output.safeParse({
      run,
      state_seq: "10",
      basis: { ...recovery, future: true },
      outcome: { kind: "failed", reason: "effect_unknown", future: true },
    }).success,
  );
  assert(
    !recoverRun.output.safeParse({
      run: otherRun,
      state_seq: "10",
      basis: recovery,
      outcome: null,
    }).success,
  );
  assert(
    !recoverRun.output.safeParse({
      run,
      state_seq: "10",
      basis: {
        ...recovery,
        boundary: "outside_call",
        call,
        resolution: "finish",
      },
      outcome: null,
    }).success,
  );
});
