// 모든 command가 같이 쓰는 event 내기와 재실행.
import type { Result } from "../../../../base/mod.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

// event 하나를 내고 그 seq(문자열)를 돌려준다. revision은 이 seq다. deps.emit이 있으면 그 함수가 정한
// 실제 seq를 쓴다.
export function emitEvent(
  state: ContextApiState,
  deps: ContextApiDeps,
  event: {
    type: string;
    subject: string;
    actor: string;
    payload: Record<string, unknown>;
  },
): string {
  const seq = deps.emit ? deps.emit(event) : String(state.seq + 1);
  state.seq = Number(seq);
  state.events.push({ seq, at: deps.now(), ...event });
  return seq;
}

// 같은 idempotency key의 되풀이는 처음 성공 결과를 그대로 돌려주고 아무것도 바꾸지 않는다.
// 거절은 기억하지 않는다(다시 부르면 다시 판정한다).
export function withReplay<T>(
  state: ContextApiState,
  key: string,
  run: () => Result<T>,
): Result<T> {
  if (state.replays.has(key)) return state.replays.get(key) as Result<T>;
  const result = run();
  if (result.ok) state.replays.set(key, result);
  return result;
}
