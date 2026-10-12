import type { SqlParams, SqlRow } from "../../../protocol/server/mod.ts";

// 사람 기다림의 판정과 읽기 조회. 순수 함수와 읽기 조회만 있다. 쓰기는 commands.ts가 한다.
// 판정은 domain-model lophn-agent/harness/waiting-and-recovery의 "기다림의 끝" 표 그대로다.
// 결정 값(답·허락)은 입력으로 받지 않는다. 요청을 소유한 영역의 ledger 행만 읽는다.

export type WaitKind = "question" | "approval";

export function kindOf(request: string): WaitKind {
  return request.startsWith("qgr_") ? "question" : "approval";
}

type Lookup = {
  sql: {
    get: (query: string, params: SqlParams) => SqlRow | undefined;
    all: (query: string, params: SqlParams) => SqlRow[];
  };
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

// ---------------------------------------------------------------------------
// 판정(순수)
// ---------------------------------------------------------------------------

export type QuestionFacts = {
  status: "pending" | "answered" | "expired" | "cancelled";
  // 고른 선택지에 고정 action이 있는지. 자유 답과 action 없는 선택지는 false다. 고정 action이
  // 있는 질문은 질문 하나짜리 묶음이라 묶음 전체의 사실이다.
  chosenHasAction: boolean;
  // action의 실제 적용 결과(questions의 `applied`).
  applied: boolean;
};

export type QuestionVerdict =
  | { kind: "pending" }
  // 답은 받았지만 고정 action의 적용을 아직 확인하지 못했다. 접수와 적용은 다르다.
  | { kind: "action_pending" }
  | { kind: "resume"; result: "resumed"; reason: "question_answered" }
  | { kind: "stop"; result: "stopped_no_answer"; reason: "no_answer" };

// 질문 묶음의 답이면 같은 run 재개, 만료·미루기·취소는 답 없음 종료다. 답이 아닌 것으로
// 재개하지 않고 추정 답도 만들지 않는다. 묶음은 한 번에 답하므로 일부만 답한 상태는 없다.
export function questionVerdict(facts: QuestionFacts): QuestionVerdict {
  if (facts.status === "pending") return { kind: "pending" };
  if (facts.status === "answered") {
    if (facts.chosenHasAction && !facts.applied) {
      return { kind: "action_pending" };
    }
    return { kind: "resume", result: "resumed", reason: "question_answered" };
  }
  return { kind: "stop", result: "stopped_no_answer", reason: "no_answer" };
}

export type ApprovalStatus =
  | "pending"
  | "granted"
  | "rejected"
  | "expired"
  | "cancelled";

export type CallFacts = {
  state: "requested" | "started" | "finished";
  // 실제로 진입한 call인지(started_at). 진입하지 않고 끝난 call은 false다.
  entered: boolean;
  outcome: { kind: string; code: string } | null;
};

export type ApprovalVerdict =
  | { kind: "pending" }
  // 허락됐고 고정 call이 재검사를 통과해 시작됐다.
  | { kind: "call"; result: "call_started"; reason: "approval_allowed" }
  // 고정 call은 미실행으로 닫혔다. 거절·만료·취소는 human_decision, 재검사 실패는 그 이유다.
  | { kind: "call"; result: "call_not_executed"; reason: string }
  // 허락됐지만 재검사·시작이 아직 없다. 허락은 시작이 아니다.
  | { kind: "needs_recheck" }
  // 사람이 닫았지만 고정 call이 아직 미실행으로 닫히지 않았다.
  | { kind: "needs_close" }
  | { kind: "inconsistent"; why: string };

// approval 결정 하나가 고정 call에 어떻게 반영됐는지. 과거 허락이 달라진 동작을 시작하지
// 못하므로 허락만으로는 해소하지 않고 재검사가 끝난 call 상태를 요구한다.
export function approvalVerdict(
  status: ApprovalStatus,
  call: CallFacts | undefined,
): ApprovalVerdict {
  if (status === "pending") return { kind: "pending" };
  if (call === undefined) {
    return { kind: "inconsistent", why: "the fixed call is not known" };
  }
  const closedUnentered = call.state === "finished" && !call.entered &&
    call.outcome?.kind === "not_executed";
  if (status === "granted") {
    if (call.entered) {
      return {
        kind: "call",
        result: "call_started",
        reason: "approval_allowed",
      };
    }
    if (closedUnentered) {
      return {
        kind: "call",
        result: "call_not_executed",
        reason: call.outcome?.code ?? "recheck_failed",
      };
    }
    return { kind: "needs_recheck" };
  }
  if (call.entered) {
    return { kind: "inconsistent", why: "a closed request started its call" };
  }
  if (closedUnentered) {
    return {
      kind: "call",
      result: "call_not_executed",
      reason: "human_decision",
    };
  }
  return { kind: "needs_close" };
}

// 기다림이 끝난 이유의 구별. 어느 것도 허락으로 바꾸지 않는다.
export type WaitEndKind =
  | "denied_by_rule"
  | "rejected_by_person"
  | "undecided"
  | "expired"
  | "cancelled"
  | "invalidated"
  | "channel_unavailable"
  | "judgment_failed";

export type WaitEnd = {
  kind: WaitEndKind;
  // 허락으로 읽히는 끝은 없다.
  allows: false;
  // 사람의 거절·만료·취소와 아직 정하지 않은 상태는 tool·run 실패 수에 세지 않는다.
  counts_as_failure: boolean;
};

const FAILURE_KINDS: ReadonlySet<WaitEndKind> = new Set([
  "channel_unavailable",
  "judgment_failed",
]);

export function waitEnd(kind: WaitEndKind): WaitEnd {
  return { kind, allows: false, counts_as_failure: FAILURE_KINDS.has(kind) };
}

// owner ledger의 approval 상태를 끝 종류로. 허락은 끝이 아니라 재검사의 시작이므로 null이다.
export function endOfApproval(status: ApprovalStatus): WaitEnd | null {
  switch (status) {
    case "pending":
      return waitEnd("undecided");
    case "rejected":
      return waitEnd("rejected_by_person");
    case "expired":
      return waitEnd("expired");
    case "cancelled":
      return waitEnd("cancelled");
    case "granted":
      return null;
  }
}

// ---------------------------------------------------------------------------
// 보이는 기다림과 retry 대기, 순수 함수
// ---------------------------------------------------------------------------

export type WaitReason =
  | { kind: "assignment_turn"; assignment: string }
  | { kind: "question"; group: string; expires_at: string | null }
  | { kind: "approval"; approval: string; expires_at: string | null }
  | {
    kind: "provider_retry";
    model_call: string;
    // 서버나 정책이 확인해 준 예정 시각. 모르면 null이다.
    retry_at: string | null;
    // 확인된 횟수. 모르면 null이다.
    attempt: number | null;
    max_attempts: number | null;
  }
  | {
    kind: "usage_wait";
    credential: string;
    // reset 시각을 확인했을 때만 값이 있다.
    reset_at: string | null;
  };

export type WaitAction =
  | "answer_question"
  | "decide_approval"
  | "open_settings";

export type WaitView = {
  // 무엇을 기다리는지(대상).
  target: string;
  reason: WaitReason["kind"];
  // 확인된 시각에만 countdown을 붙인다. 시각을 모르면 null이다(근거 없는 예측 금지).
  countdown_to: string | null;
  // 확인된 횟수에만 붙인다.
  attempt: { used: number; max: number } | null;
  // 사람만 풀 수 있는 대기에만 행동이 있다.
  action: WaitAction | null;
};

export function waitView(reason: WaitReason): WaitView {
  switch (reason.kind) {
    case "assignment_turn":
      return {
        target: reason.assignment,
        reason: reason.kind,
        countdown_to: null,
        attempt: null,
        action: null,
      };
    case "question":
      return {
        target: reason.group,
        reason: reason.kind,
        countdown_to: reason.expires_at,
        attempt: null,
        action: "answer_question",
      };
    case "approval":
      return {
        target: reason.approval,
        reason: reason.kind,
        countdown_to: reason.expires_at,
        attempt: null,
        action: "decide_approval",
      };
    case "provider_retry":
      return {
        target: reason.model_call,
        reason: reason.kind,
        countdown_to: reason.retry_at,
        attempt: reason.attempt !== null && reason.max_attempts !== null
          ? { used: reason.attempt, max: reason.max_attempts }
          : null,
        action: null,
      };
    case "usage_wait":
      return {
        target: reason.credential,
        reason: reason.kind,
        countdown_to: reason.reset_at,
        attempt: null,
        // reset을 모르면 사람이 다른 계정을 고르거나 설정을 바꿔야 풀린다.
        action: reason.reset_at === null ? "open_settings" : null,
      };
  }
}

export type RetryWaitInput = {
  // 보존한 예정 시각(ISO). 없으면 대기 예정이 없다.
  retry_at: string | null;
  // 이미 쓴 retry 횟수와 누적 한도. 재시작이 초기화하지 않는다.
  used: number;
  max: number;
  now_ms: number;
  // 대기를 깨우는 것: 사람의 멈춤, steering 입력, 누적 한도.
  interrupt: "stop" | "steering" | "limit" | null;
};

export type RetryWaitResult = {
  // now: 지금 깨어난다. wait: 남은 간격만 기다린 뒤 다음 시도.
  wake: "now" | "wait" | "exhausted";
  remaining_ms: number;
  used: number;
  // 깨어난 뒤 새 retry를 시작해도 되는지. 멈춤·steering·한도는 retry를 이어 가지 않는다.
  may_retry: boolean;
};

// 재시작 뒤 retry 대기 하나를 잇는 규칙. 예정 시각은 처음부터 다시 재지 않고 남은 간격만
// 기다리며 사용 횟수는 그대로 보존한다. 멈춤·steering·한도는 대기를 즉시 깨운다. 사람
// 기다림은 실패 횟수가 아니므로 used를 늘리지 않는다.
export function retryWait(input: RetryWaitInput): RetryWaitResult {
  const used = input.used;
  if (input.interrupt !== null) {
    return { wake: "now", remaining_ms: 0, used, may_retry: false };
  }
  if (used >= input.max) {
    return { wake: "exhausted", remaining_ms: 0, used, may_retry: false };
  }
  const at = input.retry_at === null ? null : Date.parse(input.retry_at);
  const remaining = at === null || Number.isNaN(at)
    ? 0
    : Math.max(0, at - input.now_ms);
  return {
    wake: remaining > 0 ? "wait" : "now",
    remaining_ms: remaining,
    used,
    may_retry: true,
  };
}

// 사람 기다림은 실패 횟수에 세지 않는다. 기다림 때문에 실패·retry 수가 바뀌지 않는다.
export function waitCountsAsFailure(): false {
  return false;
}

// ---------------------------------------------------------------------------
// 읽기 조회
// ---------------------------------------------------------------------------

export type ApprovalFacts = {
  id: string;
  requester: string;
  run: string | null;
  status: ApprovalStatus;
  binding_hash: string;
  reason_blob: string;
  effect: string;
  action: string;
  expires_at: string | null;
  created_seq: string;
  closed_seq: string | null;
  used: boolean;
};

// platform/approvals의 표를 읽기만 한다(다른 command처럼 같은 Tx에서 상태만 본다).
export function loadApproval(
  lookup: Lookup,
  id: string,
): ApprovalFacts | undefined {
  const row = lookup.sql.get(
    `select id, requester, run, status, action_binding_hash, reason_blob,
       effect, action, expires_at, created_seq, closed_seq,
       exists (select 1 from approval_uses where approval = approval_requests.id) as used
     from approval_requests where id = ?`,
    [id],
  );
  if (row === undefined) return undefined;
  return {
    id: String(row["id"]),
    requester: String(row["requester"]),
    run: text(row["run"]),
    status: String(row["status"]) as ApprovalStatus,
    binding_hash: String(row["action_binding_hash"]),
    reason_blob: String(row["reason_blob"]),
    effect: String(row["effect"]),
    action: String(row["action"]),
    expires_at: text(row["expires_at"]),
    created_seq: String(row["created_seq"]),
    closed_seq: text(row["closed_seq"]),
    used: Number(row["used"]) === 1,
  };
}

// 이 run이 기다릴 때 고정한 call. RunWaited event가 근거다(요청과 call을 같은 transaction에서
// 남긴다). 같은 요청을 기다린 event가 없으면 null이다.
export function waitedCall(
  lookup: Lookup,
  run: string,
  request: string,
): { found: boolean; call: string | null } {
  const row = lookup.sql.get(
    `select json_extract(payload, '$.call') as call from events
     where type = 'RunWaited' and subject = ?
       and json_extract(payload, '$.request') = ?
     order by seq desc limit 1`,
    [run, request],
  );
  return row === undefined
    ? { found: false, call: null }
    : { found: true, call: text(row["call"]) };
}

export type ResolutionRow = {
  run: string;
  request: string;
  decision_seq: string;
  tool_call: string | null;
  result: string;
  reason: string;
  resolved_seq: string | null;
};

export function loadResolution(
  lookup: Lookup,
  request: string,
  decisionSeq: string,
): ResolutionRow | undefined {
  const row = lookup.sql.get(
    `select run, request, decision_seq, tool_call, result, reason, resolved_seq
     from run_wait_resolutions where request = ? and decision_seq = ?`,
    [request, Number(decisionSeq)],
  );
  if (row === undefined) return undefined;
  return {
    run: String(row["run"]),
    request: String(row["request"]),
    decision_seq: String(row["decision_seq"]),
    tool_call: text(row["tool_call"]),
    result: String(row["result"]),
    reason: String(row["reason"]),
    resolved_seq: text(row["resolved_seq"]),
  };
}
