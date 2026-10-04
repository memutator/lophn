import { REPORTING_LIMITS } from "@lophn/contracts/problems/sdk-report";
import type {
  ExceptionObservationError,
  ExceptionObservationInput,
  ExceptionObserverTransport,
  ObservationInvocationEvidence,
  ObservationMissingReason,
  ReportCompletion,
} from "@lophn/contracts/problems/sdk-report";
import { deliver, freezeDeep, queueRejection, utf8Length } from "./deliver.ts";

const REPORT_PREFIX = "rpt";
const ULID_LENGTH = 26;

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

function textOrMissing(
  value: unknown,
): { text: string | null; missing: ObservationMissingReason | null } {
  if (typeof value === "string") return { text: value, missing: null };
  return { text: null, missing: missing("not a string") };
}

function observeError(reason: unknown): ExceptionObservationError {
  const error = reason instanceof Error ? reason : null;
  const name = error && error.name.trim() !== "" ? error.name : "UnknownError";
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

export type ExceptionObserver = {
  uninstall(): void;
  completion(reportId: string): Promise<ReportCompletion> | null;
};

export function installExceptionObserver(
  transport: ExceptionObserverTransport,
  deps: ExceptionObserverDeps,
): ExceptionObserver {
  const target = deps.target ?? globalThis;
  const queue = new Map<string, Pending>();
  const completions = new Map<string, Promise<ReportCompletion>>();
  let pendingBytes = 0;
  let installed = true;

  const capture = (kind: "error" | "unhandledrejection", reason: unknown) => {
    if (!installed) return;
    const reportId = deps.newId(REPORT_PREFIX);
    if (
      !reportId.startsWith(`${REPORT_PREFIX}_`) ||
      reportId.length !== REPORT_PREFIX.length + 1 + ULID_LENGTH
    ) {
      throw new Error("report id source returned a non-report id");
    }
    const input: ExceptionObservationInput = freezeDeep(structuredClone({
      report_id: reportId,
      observed_at: deps.now(),
      observation: kind,
      error: observeError(reason),
      error_missing_reason: null,
      invocation: deps.currentInvocation(),
    }));
    const bytes = utf8Length(input);
    const overCount = queue.size >= REPORTING_LIMITS.sdk_pending_count;
    const overBytes = pendingBytes + bytes > REPORTING_LIMITS.sdk_pending_bytes;
    const completion = overCount || overBytes
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

  return {
    uninstall() {
      if (!installed) return;
      installed = false;
      target.removeEventListener("error", onError);
      target.removeEventListener("unhandledrejection", onRejection);
    },
    completion(reportId: string) {
      return completions.get(reportId) ?? null;
    },
  };
}
