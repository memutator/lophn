import type { ModelOutcome } from "../../../protocol/lophn-agent/mod.ts";

// retry 규칙(requirements lophn-agent/harness/run-loop R23, R24). 순수 계산이다. 시계·대기·무작위는
// 호출자가 주입한다. 모든 retry는 새 시도 하나이고 SDK의 숨은 retry는 없다.

export const MODEL_RETRY_MAX = 2;
// 서버가 시각을 주지 않았을 때 첫째·둘째 retry 앞의 대기.
export const MODEL_RETRY_DEFAULT_MS: readonly [number, number] = [2000, 4000];

export const TOOL_RETRY_MAX = 1;
export const TOOL_RETRY_BASE_MS = 1000;
export const TOOL_RETRY_JITTER = 0.1;

// provider가 일시 실패로 분류한 통신만 같은 입력으로 다시 보낸다(R23). 부분 응답·취소·불명확은
// retry 대상이 아니다.
export function isTransientFailure(outcome: ModelOutcome): boolean {
  return outcome.kind === "failed" && outcome.code === "temporary";
}

// n번째(1부터) retry 앞의 대기 ms. 서버의 최소 재시도 시각이 있으면 그 시각을 지키고 앞당기지
// 않는다. 없으면 2초·4초다.
export function modelRetryDelayMs(
  retryNumber: number,
  retryAt: string | null,
  nowMs: number,
): number {
  if (retryAt !== null) return Math.max(0, Date.parse(retryAt) - nowMs);
  const index = Math.min(retryNumber, MODEL_RETRY_MAX) - 1;
  return MODEL_RETRY_DEFAULT_MS[index];
}

// tool 자동 retry는 읽기 또는 최초 호출의 중복 효과 없음이 계약으로 보장된 쓰기에만 허용한다
// (R24). external과 보장 없는 쓰기는 다시 부르지 않는다.
export function toolMayRetry(
  tool: { effect: "read" | "write" | "external"; idempotent: boolean },
): boolean {
  return tool.effect === "read" ||
    (tool.effect === "write" && tool.idempotent);
}

// 일시적일 수 있는 실패만 다시 본다. 거절·잘못된 입력·사라진 대상·권한·문맥 초과·사람 멈춤은
// 같은 요청을 다시 보내지 않는다(R24).
const RETRYABLE_TOOL_CODES: ReadonlySet<string> = new Set([
  "unavailable",
  "internal",
  "uncertain",
]);

export function toolFailureRetryable(
  attempt: { status: string; code: string },
): boolean {
  return (attempt.status === "failure" || attempt.status === "uncertain") &&
    RETRYABLE_TOOL_CODES.has(attempt.code);
}

// 1초에 ±10% jitter. random은 [0, 1)이다.
export function toolRetryDelayMs(random: () => number): number {
  const spread = (random() * 2 - 1) * TOOL_RETRY_JITTER;
  return Math.round(TOOL_RETRY_BASE_MS * (1 + spread));
}

// 실제 timer 대기. 신호가 중단되면 바로 돌아온다.
export function abortableWait(
  ms: number,
  signal: AbortSignal,
): Promise<"elapsed" | "aborted"> {
  if (signal.aborted) return Promise.resolve("aborted");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve("elapsed");
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve("aborted");
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
