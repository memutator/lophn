import { REPORTING_LIMITS } from "@lophn/protocol/problems/sdk-report";
import type {
  ObservationInvocationEvidence,
  ReportCompletion,
  ReportProblemResult,
  ReportStatus,
  ReportTransport,
  SafeReportDetails,
} from "@lophn/protocol/problems/sdk-report";
import type {
  ProblemReportCall,
  ProblemReportRequest,
} from "../../protocol/problems/sdk-problem.ts";
import { deliver, freezeDeep, queueRejection, utf8Length } from "./deliver.ts";

const REPORT_PREFIX = "rpt";

export type ProblemReporterDeps = {
  transport: ReportTransport<ProblemReportRequest>;
  now: () => string;
  newId: (prefix: string) => string;
  sleep: (ms: number) => Promise<void>;
  currentInvocation: () => ObservationInvocationEvidence | null;
};

type Pending = {
  bytes: number;
  input: Readonly<ProblemReportRequest>;
};

const KEPT_REPORTS = 32;
const NAME_MAX_CHARS = 120;

// 이름은 문제를 묶는 key의 일부다. 제어 문자 없는 1~120자, 공백만은 안 된다.
function validName(name: unknown): boolean {
  return typeof name === "string" && name.length <= NAME_MAX_CHARS &&
    /\S/.test(name) && !/\p{Cc}/u.test(name);
}

function validMessage(message: unknown): boolean {
  return typeof message === "string" && /\S/.test(message);
}

export function createProblemReporter(
  deps: ProblemReporterDeps,
): ProblemReportCall & { status(reportId: string): ReportStatus | null } {
  const queue = new Map<string, Pending>();
  const sent = new Map<string, Readonly<ProblemReportRequest>>();
  let pendingBytes = 0;

  const remember = (
    reportId: string,
    input: Readonly<ProblemReportRequest>,
  ) => {
    sent.delete(reportId);
    sent.set(reportId, input);
    while (sent.size > KEPT_REPORTS) {
      const oldest = sent.keys().next().value;
      if (oldest === undefined) break;
      sent.delete(oldest);
    }
  };

  const reportProblem = (
    name: string,
    message: string,
    details?: SafeReportDetails,
  ): ReportProblemResult => {
    const reportId = deps.newId(REPORT_PREFIX);
    if (!validName(name) || !validMessage(message)) {
      return {
        report_id: reportId,
        completion: Promise.resolve({
          status: "failed",
          reason: {
            code: "invalid_input",
            message: "report needs a name (1~120 characters) and a message",
          },
        }),
      };
    }
    let input: Readonly<ProblemReportRequest>;
    try {
      input = freezeDeep(structuredClone({
        report_id: reportId,
        name,
        message,
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
    remember(reportId, input);
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

  const status = (reportId: string): ReportStatus | null =>
    queue.has(reportId) ? { status: "pending" } : null;

  const retransmit = (
    reportId: string,
    details?: SafeReportDetails,
  ): Promise<ReportCompletion> | null => {
    const held = sent.get(reportId);
    if (held === undefined) return null;
    const input = details === undefined
      ? held
      : freezeDeep(structuredClone({ ...held, details }));
    return deliver(
      () => deps.transport(input),
      deps.sleep,
      "report response lost",
    );
  };

  return Object.assign(reportProblem, { status, retransmit });
}
