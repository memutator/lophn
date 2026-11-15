import {
  createObserver,
  type ExceptionObserver,
  type ExceptionObserverDeps,
} from "./observer.ts";

// 폰 backend에는 처리 못한 예외를 알리는 event가 없다. 던진 호출은 host가 실패로 받으므로 걸 곳이 없고,
// 앱이 부른 `reportProblem`만 남는다.
export function createExceptionObserver(
  deps: ExceptionObserverDeps,
): ExceptionObserver {
  return createObserver(deps, () => () => {});
}
