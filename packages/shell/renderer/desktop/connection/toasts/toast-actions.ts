// toast 행동 단추를 누르면 처리할 쪽을 찾는 목록. 지금 보이는 화면이 마운트되는 동안 자기 처리기를 등록하고,
// 기본 처리(다른 화면으로 가서 여는 일)는 desktop 최상위가 등록한다.
import type { ReactionAction } from "../events/reactions.ts";

/** `machine`이 있으면 그 기계의 session·앱이다. */
export type ToastAction = ReactionAction & { readonly machine?: string };

/** 처리했으면 true. */
type ToastActionHandler = (action: ToastAction) => boolean;

const handlers: ToastActionHandler[] = [];

/** 반환 함수가 해제한다. */
export function registerToastActionHandler(
  handler: ToastActionHandler,
): () => void {
  handlers.push(handler);
  return () => {
    const at = handlers.indexOf(handler);
    if (at >= 0) handlers.splice(at, 1);
  };
}

/** 나중에 등록한 처리기부터 불러 처음 true를 낸 처리기가 처리한다. 아무도 처리하지 못하면 아무 일도 하지 않는다. */
export function runToastAction(action: ToastAction): void {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i](action)) return;
  }
}
