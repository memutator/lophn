import {
  isRetryableReportError,
  REPORT_RETRY_DELAYS_MS,
} from "@lophn/protocol/problems/sdk-report";
import type {
  ReportAcceptance,
  ReportCompletion,
  ReportTransportError,
} from "@lophn/protocol/problems/sdk-report";

type Outcome =
  | { ok: true; value: ReportAcceptance }
  | {
      ok: false;
      error: ReportTransportError;
    };

export function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function utf8Length(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function queueRejection(overCount: boolean): ReportTransportError {
  return {
    code: "unavailable",
    message: overCount
      ? "sdk report queue is full"
      : "sdk report queue byte limit exceeded",
  };
}

// Same frozen input on every attempt. Sleep only before a retry, never before
// the first send, so a retry never reruns the app command behind the input.
export async function deliver(
  send: () => Promise<Outcome>,
  sleep: (ms: number) => Promise<void>,
  lost: string,
): Promise<ReportCompletion> {
  const attempts = REPORT_RETRY_DELAYS_MS.length + 1;
  let last: ReportTransportError = {
    code: "unavailable",
    message: "report was not sent",
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(REPORT_RETRY_DELAYS_MS[attempt - 1]);
    try {
      const result = await send();
      if (result.ok) return { status: "accepted", acceptance: result.value };
      last = result.error;
    } catch {
      // A dropped response is a value, not a new unhandledrejection.
      last = { code: "response_lost", message: lost };
    }
    if (!isRetryableReportError(last)) break;
  }
  return { status: "failed", reason: last };
}
