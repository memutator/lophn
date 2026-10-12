import { assertEquals } from "@std/assert";
import {
  approvalVerdict,
  endOfApproval,
  kindOf,
  questionVerdict,
  retryWait,
  waitCountsAsFailure,
  waitEnd,
  type WaitEndKind,
  waitView,
} from "./mod.ts";

// 판정표와 보이는 기다림·retry 대기는 순수 함수다. 실제 core를 띄운 흐름(질문 답으로 재개, approval
// 허락으로 재개, 수정, 재시작)은 packages/core/lophn-agent/waiting-and-recovery/waiting-core_test.ts가 본다.

Deno.test("lophn-agent/harness/waiting-and-recovery#R1 [agent-I13]: 질문 묶음의 답이면 재개, 만료·미루기·취소는 답 없음 종료, 미결정은 기다림", () => {
  const plain = { chosenHasAction: false, applied: false };
  assertEquals(questionVerdict({ ...plain, status: "pending" }), {
    kind: "pending",
  });
  assertEquals(questionVerdict({ ...plain, status: "answered" }), {
    kind: "resume",
    result: "resumed",
    reason: "question_answered",
  });
  for (const status of ["expired", "cancelled"] as const) {
    assertEquals(questionVerdict({ ...plain, status }), {
      kind: "stop",
      result: "stopped_no_answer",
      reason: "no_answer",
    });
  }
  // 기다림의 요청은 질문 묶음(qgr)이나 approval request(apr)다.
  assertEquals(kindOf("qgr_01arz3ndektsv4rrffq69g5faa"), "question");
  assertEquals(kindOf("apr_01arz3ndektsv4rrffq69g5faa"), "approval");
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R5 [agent-I13]: 고정 action이 있는 선택지의 묶음 답은 적용을 확인하기 전에는 재개하지 않는다", () => {
  const answered = { status: "answered" as const, chosenHasAction: true };
  assertEquals(questionVerdict({ ...answered, applied: false }), {
    kind: "action_pending",
  });
  assertEquals(questionVerdict({ ...answered, applied: true }).kind, "resume");
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R2: 허락은 재검사가 끝난 call 상태에서만 해소되고 거절·만료·취소는 human_decision 미실행이다", () => {
  const requested = {
    state: "requested" as const,
    entered: false,
    outcome: null,
  };
  const started = {
    state: "started" as const,
    entered: true,
    outcome: null,
  };
  const closed = (code: string) => ({
    state: "finished" as const,
    entered: false,
    outcome: { kind: "not_executed", code },
  });
  // 허락만으로는 시작하지 않는다.
  assertEquals(approvalVerdict("granted", requested), {
    kind: "needs_recheck",
  });
  assertEquals(approvalVerdict("granted", started), {
    kind: "call",
    result: "call_started",
    reason: "approval_allowed",
  });
  // 재검사 실패는 미실행으로 남고 이유를 그대로 둔다.
  assertEquals(approvalVerdict("granted", closed("recheck_failed")), {
    kind: "call",
    result: "call_not_executed",
    reason: "recheck_failed",
  });
  for (const status of ["rejected", "expired", "cancelled"] as const) {
    assertEquals(approvalVerdict(status, requested), { kind: "needs_close" });
    assertEquals(approvalVerdict(status, closed("human_decision")), {
      kind: "call",
      result: "call_not_executed",
      reason: "human_decision",
    });
    // 닫힌 요청의 call이 시작됐으면 어긋난 기록이다. 해소하지 않는다.
    assertEquals(approvalVerdict(status, started).kind, "inconsistent");
  }
  assertEquals(approvalVerdict("pending", requested), { kind: "pending" });
  assertEquals(approvalVerdict("granted", undefined).kind, "inconsistent");
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R3: 규칙 금지·사람 거절·미결정·만료·취소·종료·통로·판정 실패를 구별하고 어느 것도 허락이 아니며 사람 결정은 실패 수에 세지 않는다", () => {
  const kinds: WaitEndKind[] = [
    "denied_by_rule",
    "rejected_by_person",
    "undecided",
    "expired",
    "cancelled",
    "invalidated",
    "channel_unavailable",
    "judgment_failed",
  ];
  assertEquals(new Set(kinds.map((kind) => waitEnd(kind).kind)).size, 8);
  for (const kind of kinds) assertEquals(waitEnd(kind).allows, false);
  for (
    const kind of [
      "rejected_by_person",
      "expired",
      "cancelled",
      "undecided",
    ] as const
  ) assertEquals(waitEnd(kind).counts_as_failure, false);
  for (const kind of ["channel_unavailable", "judgment_failed"] as const) {
    assertEquals(waitEnd(kind).counts_as_failure, true);
  }
  // owner ledger의 상태가 끝 종류를 정한다. 허락은 끝이 아니다.
  assertEquals(endOfApproval("rejected")?.kind, "rejected_by_person");
  assertEquals(endOfApproval("expired")?.kind, "expired");
  assertEquals(endOfApproval("cancelled")?.kind, "cancelled");
  assertEquals(endOfApproval("pending")?.kind, "undecided");
  assertEquals(endOfApproval("granted"), null);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R6 [agent-I13]: 대기는 대상·이유를 주고 확인된 시각·횟수에만 countdown·횟수를 붙이며 사람이 풀어야 하는 대기에만 행동이 있다", () => {
  const turn = waitView({ kind: "assignment_turn", assignment: "asg_1" });
  assertEquals(turn, {
    target: "asg_1",
    reason: "assignment_turn",
    countdown_to: null,
    attempt: null,
    action: null,
  });
  // 기한 없는 질문은 countdown이 없고, 기한이 있으면 그 시각이다.
  const open = waitView({
    kind: "question",
    group: "qgr_1",
    expires_at: null,
  });
  assertEquals(open.target, "qgr_1");
  assertEquals(open.countdown_to, null);
  assertEquals(open.action, "answer_question");
  assertEquals(
    waitView({
      kind: "approval",
      approval: "apr_1",
      expires_at: "2026-01-01T00:10:00.000Z",
    }).countdown_to,
    "2026-01-01T00:10:00.000Z",
  );
  assertEquals(
    waitView({ kind: "approval", approval: "apr_1", expires_at: null }).action,
    "decide_approval",
  );
  // retry는 확인된 예정 시각·횟수만 보이고 행동이 없다.
  const known = waitView({
    kind: "provider_retry",
    model_call: "mcl_1",
    retry_at: "2026-01-01T00:00:02.000Z",
    attempt: 1,
    max_attempts: 2,
  });
  assertEquals(known.countdown_to, "2026-01-01T00:00:02.000Z");
  assertEquals(known.attempt, { used: 1, max: 2 });
  assertEquals(known.action, null);
  const unknown = waitView({
    kind: "provider_retry",
    model_call: "mcl_1",
    retry_at: null,
    attempt: null,
    max_attempts: null,
  });
  assertEquals(unknown.countdown_to, null);
  assertEquals(unknown.attempt, null);
  // 사용량 대기는 reset 시각을 알면 기다림만, 모르면 설정 행동이 있다.
  assertEquals(
    waitView({ kind: "usage_wait", credential: "k", reset_at: null }).action,
    "open_settings",
  );
  assertEquals(
    waitView({
      kind: "usage_wait",
      credential: "k",
      reset_at: "2026-01-01T01:00:00.000Z",
    }).action,
    null,
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R7: 재시작 뒤 retry는 남은 간격만 기다리고 횟수를 보존하며 멈춤·steering·한도는 대기를 즉시 깨우고 사람 기다림은 실패로 세지 않는다", () => {
  const at = "2026-01-01T00:00:04.000Z";
  const now = Date.parse("2026-01-01T00:00:01.000Z");
  // 처음부터 다시 재지 않고 남은 3초만 기다린다. 사용 횟수는 그대로다.
  assertEquals(
    retryWait({ retry_at: at, used: 1, max: 2, now_ms: now, interrupt: null }),
    { wake: "wait", remaining_ms: 3000, used: 1, may_retry: true },
  );
  // 이미 지난 예정 시각은 바로 이어 간다.
  assertEquals(
    retryWait({
      retry_at: at,
      used: 1,
      max: 2,
      now_ms: Date.parse("2026-01-01T00:00:09.000Z"),
      interrupt: null,
    }).wake,
    "now",
  );
  // 한도를 다 쓴 횟수는 초기화되지 않는다.
  assertEquals(
    retryWait({ retry_at: at, used: 2, max: 2, now_ms: now, interrupt: null })
      .wake,
    "exhausted",
  );
  for (const interrupt of ["stop", "steering", "limit"] as const) {
    assertEquals(
      retryWait({ retry_at: at, used: 1, max: 2, now_ms: now, interrupt }),
      { wake: "now", remaining_ms: 0, used: 1, may_retry: false },
    );
  }
  assertEquals(waitCountsAsFailure(), false);
});
