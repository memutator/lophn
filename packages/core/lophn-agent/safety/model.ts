import { canonicalize, sha256Hex } from "../../../base/mod.ts";
import type { ToolOutcome } from "../../../protocol/lophn-agent/mod.ts";

// 같은 요청 비교(domain-model lophn-agent/harness/safety RepeatedFailure).
// tool·대상·입력이 같은 경우만 같다. canonical JSON은 객체 key 순서만 무시하고
// 문자열 공백·배열 순서·빈 값·생략·null·값 종류는 그대로 구별한다.
export type ToolRequest = {
  tool: string;
  target: string | null;
  args: unknown;
};

export function requestKey(request: ToolRequest): Promise<string> {
  return sha256Hex(canonicalize(request));
}

// 실패 수는 그 요청이 성공할 때만 0이 된다. 다른 요청의 성공·실패, model 변경,
// compaction, 재시작은 이 값을 지우지 않는다.
export type RepeatedFailure = {
  run: string;
  request_key: string;
  final_failures: number;
  blocked: boolean;
  block_call: string | null;
};

// 최종 실패는 자동 retry가 모두 끝난 뒤 한 요청당 한 번 센다. 사람 거절과
// 미실행 outcome은 실패 수에 넣지 않는다.
export function isFinalFailure(outcome: ToolOutcome): boolean {
  return outcome.kind === "failure";
}

export function countFailure(
  state: RepeatedFailure | null,
): RepeatedFailure {
  const failures = (state?.final_failures ?? 0) + 1;
  return {
    run: state?.run ?? "",
    request_key: state?.request_key ?? "",
    final_failures: failures,
    blocked: failures >= 2,
    block_call: state?.block_call ?? null,
  };
}

// 세 번째 진입이 미실행 안내로 기록되면 그 안내 call을 근거로 남긴다.
export function recordBlockNotice(
  state: RepeatedFailure,
  noticeCallId: string,
): RepeatedFailure {
  return { ...state, block_call: noticeCallId };
}

// 두 번 실패한 요청의 세 번째 진입은 미실행으로 막는다. 차단 안내 뒤 같은
// 요청을 다시 요구하면 차단 자체가 유한하게 끝난다.
export type BlockDecision =
  | { kind: "not_blocked" }
  | { kind: "blocked"; message: string };

export function blockVerdict(
  state: RepeatedFailure | null,
): BlockDecision {
  if (state === null || !state.blocked) return { kind: "not_blocked" };
  return {
    kind: "blocked",
    message:
      "같은 요청이 반복 실패해 세 번째 진입은 실행하지 않는다. 입력을 바꾸거나 요청을 중단하라",
  };
}

// 차단 안내 뒤 같은 요청을 한 번 더 요구하면 남은 model·tool 진입을 막고 run을
// 이유와 함께 끝낸다. 차단 안내 자체는 run을 끝내지 않고, 그 뒤 다시
// 요구할 때 끝낸다. retry·복구가 차단을 풀지 않으므로 판정은 상태만 본다.
export type RunEnd =
  | { kind: "continue" }
  | { kind: "stop"; reason: "repeated_tool_failure" };

export function runEndVerdict(
  state: RepeatedFailure | null,
): RunEnd {
  if (state === null || !state.blocked) return { kind: "continue" };
  // 세 번째 진입이 미실행 안내로 닫혔는지가 근거다. block_call은 그 안내 call이다.
  if (state.block_call == null) return { kind: "continue" };
  return { kind: "stop", reason: "repeated_tool_failure" };
}

// 해당 요청의 성공만 카운터를 0으로 되돌린다.
export function resetOnSuccess(_state: RepeatedFailure | null): null {
  return null;
}

// 사람 거절·미실행은 실패 수에 넣지 않는다.
export function isFailureCounted(outcome: ToolOutcome): boolean {
  if (outcome.code === "human_decision") return false;
  if (outcome.kind === "not_executed") return false;
  return outcome.kind === "failure";
}
