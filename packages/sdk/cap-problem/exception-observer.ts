import { REPORTING_LIMITS } from "@lophn/protocol/problems/sdk-report";
import type {
  ExceptionObservationError,
  ExceptionObservationInput,
  ExceptionObserverTransport,
  InstallExceptionObserver,
  ObservationInvocationEvidence,
  ObservationMissingReason,
  ReportCompletion,
} from "@lophn/protocol/problems/sdk-report";
import { deliver, freezeDeep, queueRejection, utf8Length } from "./deliver.ts";

const REPORT_PREFIX = "rpt";

export type ExceptionObserverDeps = {
  now: () => string;
  newId: (prefix: string) => string;
  sleep: (ms: number) => Promise<void>;
  currentInvocation: () => ObservationInvocationEvidence | null;
  target?: EventTarget;
};

type Pending = { bytes: number };

function missing(reason: string): ObservationMissingReason {
  return { reason };
}

function textOrMissing(value: unknown): {
  text: string | null;
  missing: ObservationMissingReason | null;
} {
  if (typeof value === "string") return { text: value, missing: null };
  return { text: null, missing: missing("not a string") };
}

function observeError(reason: unknown): ExceptionObservationError {
  const error = reason instanceof Error ? reason : null;
  // 오류 이름은 문제를 묶는 key의 일부다. 비어 있으면 "UnknownError"다.
  const name =
    error && typeof error.name === "string" && error.name.trim() !== ""
      ? error.name
      : "UnknownError";
  const message = textOrMissing(error ? error.message : reason);
  const stack = textOrMissing(error ? error.stack : undefined);
  return {
    name,
    message: message.text,
    message_missing_reason: message.missing,
    stack: stack.text,
    stack_missing_reason: stack.missing,
  };
}

export type ExceptionObserver = InstallExceptionObserver & {
  completion(reportId: string): Promise<ReportCompletion> | null;
  // 지금까지 잡은 보고의 전달이 모두 끝난(성공이든 실패든) 때 풀린다. 앱 process가 죽기 전에 기다리는 데 쓴다.
  settled(): Promise<void>;
};

// The app entry point calls the returned function with its transport before
// app code loads; the call returns the uninstall function.
export function createExceptionObserver(
  deps: ExceptionObserverDeps,
): ExceptionObserver {
  const completions = new Map<string, Promise<ReportCompletion>>();
  const install = (transport: ExceptionObserverTransport): (() => void) =>
    listen(transport, deps, completions);
  return Object.assign(install, {
    completion(reportId: string) {
      return completions.get(reportId) ?? null;
    },
    async settled() {
      await Promise.allSettled([...completions.values()]);
    },
  });
}

function listen(
  transport: ExceptionObserverTransport,
  deps: ExceptionObserverDeps,
  completions: Map<string, Promise<ReportCompletion>>,
): () => void {
  const target = deps.target ?? globalThis;
  const queue = new Map<string, Pending>();
  let pendingBytes = 0;
  let installed = true;

  const capture = (kind: "error" | "unhandledrejection", reason: unknown) => {
    if (!installed) return;
    const reportId = deps.newId(REPORT_PREFIX);
    const input: ExceptionObservationInput = freezeDeep(
      structuredClone({
        report_id: reportId,
        observed_at: deps.now(),
        observation: kind,
        error: observeError(reason),
        error_missing_reason: null,
        invocation: deps.currentInvocation(),
      }),
    );
    const bytes = utf8Length(input);
    const overCount = queue.size >= REPORTING_LIMITS.sdk_pending_count;
    const overBytes = pendingBytes + bytes > REPORTING_LIMITS.sdk_pending_bytes;
    const completion =
      overCount || overBytes
        ? Promise.resolve<ReportCompletion>({
            status: "failed",
            reason: queueRejection(overCount),
          })
        : deliver(
            () => transport(input),
            deps.sleep,
            "exception response lost",
          );
    if (!overCount && !overBytes) {
      queue.set(reportId, { bytes });
      pendingBytes += bytes;
    }
    completions.set(
      reportId,
      completion.then((result) => {
        const held = queue.get(reportId);
        if (held) {
          queue.delete(reportId);
          pendingBytes -= held.bytes;
        }
        return result;
      }),
    );
  };

  const onError = (event: Event) => {
    capture("error", (event as ErrorEvent).error);
  };
  const onRejection = (event: Event) => {
    capture(
      "unhandledrejection",
      event instanceof PromiseRejectionEvent ? event.reason : undefined,
    );
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    if (!installed) return;
    installed = false;
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
