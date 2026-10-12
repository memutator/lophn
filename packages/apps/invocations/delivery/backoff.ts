// 후행 기록 전달의 재전송 간격(apps/invocations#R19). 순수 규칙이다.
// unavailable만 다시 보내고, 1초·2초·4초부터 두 배씩 최대 30초다.
import {
  INVOCATION_DELIVERY_BACKOFF_MAX_MS,
  INVOCATION_DELIVERY_BACKOFF_MS,
} from "../../../protocol/apps/mod.ts";

// attempt는 지금까지 실패한 전송 횟수(1부터)다.
export function deliveryBackoffMs(attempt: number): number {
  const steps = INVOCATION_DELIVERY_BACKOFF_MS;
  const index = Math.max(attempt, 1) - 1;
  if (index < steps.length) return steps[index];
  const last = steps[steps.length - 1];
  return Math.min(
    last * 2 ** Math.min(index - (steps.length - 1), 30),
    INVOCATION_DELIVERY_BACKOFF_MAX_MS,
  );
}

// 다시 보내는 실패는 unavailable뿐이다. 나머지는 같은 메시지로는 나아지지 않는다.
export function retryable(code: string): boolean {
  return code === "unavailable";
}
