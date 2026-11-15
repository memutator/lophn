import process from "node:process";
import {
  createObserver,
  type ExceptionObserver,
  type ExceptionObserverDeps,
} from "./observer.ts";

// 앱 process는 Node라 DOM event 대신 process event로 처리 못한 예외를 받는다.
export function createExceptionObserver(
  deps: ExceptionObserverDeps,
): ExceptionObserver {
  return createObserver(deps, (onError, onRejection) => {
    process.on("uncaughtException", onError);
    process.on("unhandledRejection", onRejection);
    return () => {
      process.off("uncaughtException", onError);
      process.off("unhandledRejection", onRejection);
    };
  });
}
