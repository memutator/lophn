import { REPORTING_LIMITS } from "@lophn/contracts/problems/sdk-report";
import type {
  ObservationInvocationEvidence,
  ReportProblem,
  ReportProblemInput,
  ReportProblemResult,
  ReportStatus,
  ReportTransport,
  SafeReportDetails,
} from "@lophn/contracts/problems/sdk-report";
import { deliver, freezeDeep, queueRejection, utf8Length } from "./deliver.ts";

const REPORT_PREFIX = "rpt";

export type ProblemReporterDeps = {
  transport: ReportTransport;
  now: () => string;
  newId: (prefix: string) => string;
  sleep: (ms: number) => Promise<void>;
  currentInvocation: () => ObservationInvocationEvidence | null;
};

type Pending = {
  bytes: number;
  input: Readonly<ReportProblemInput>;
};

export function createProblemReporter(
  deps: ProblemReporterDeps,
): ReportProblem & { status(reportId: string): ReportStatus | null } {
  const queue = new Map<string, Pending>();
  let pendingBytes = 0;

  const reportProblem = (
    code: string,
    details?: SafeReportDetails,
  ): ReportProblemResult => {
    const reportId = deps.newId(REPORT_PREFIX);
    let input: Readonly<ReportProblemInput>;
    try {
      input = freezeDeep(structuredClone({
        report_id: reportId,
        code,
        observed_at: deps.now(),
        details,
        invocation: deps.currentInvocation(),
      }));
    } catch {
      // Never throw into the app's business path; uncloneable details fail as a value.
      return {
        report_id: reportId,
        completion: Promise.resolve({
          status: "failed",
          reason: {
            code: "invalid_input",
            message: "report details are not plain data",
          },
        }),
      };
    }
    const bytes = utf8Length(input);
    const overCount = queue.size >= REPORTING_LIMITS.sdk_pending_count;
    const overBytes = pendingBytes + bytes > REPORTING_LIMITS.sdk_pending_bytes;
    if (overCount || overBytes) {
      return {
        report_id: reportId,
        completion: Promise.resolve({
          status: "failed",
          reason: queueRejection(overCount),
        }),
      };
    }
    queue.set(reportId, { bytes, input });
    pendingBytes += bytes;
    const completion = deliver(
      () => deps.transport(input),
      deps.sleep,
      "report response lost",
    ).then((result) => {
      const held = queue.get(reportId);
      if (held) {
        queue.delete(reportId);
        pendingBytes -= held.bytes;
      }
      return result;
    });
    return { report_id: reportId, completion };
  };

  reportProblem.status = (reportId: string): ReportStatus | null =>
    queue.has(reportId) ? { status: "pending" } : null;

  return reportProblem;
}
