// report collector의 접수 도구. core 감독이 띄운 worker가 쓴다. 대기 한도·retry 간격은
// 주입받고, packages/core/problems는 platform을 import하지 않는다.
import { fingerprint, type Result } from "../../../base/mod.ts";
import type {
  RecordProblemReportInput,
  ReportAcceptance,
  ReportCompletion,
  ReportTransportError,
} from "../../../protocol/problems/mod.ts";
import { isRetryableReportError } from "../../../protocol/problems/mod.ts";

// collector 기본 한도(contracts/sdk-report REPORTING_LIMITS의 collector 값과 같다).
// 등록값으로 주입받는다.
export const COLLECTOR_CAPS = {
  pending_count: 128,
  pending_bytes: 16_777_216,
  concurrent_assembly: 4,
} as const;

// content hash는 접수 내용에서 결정적으로 정한다. 준비 handle·시각은 넣지 않는다.
// 입력은 report(content_hash 제외)·snapshot·묶는 key·기존 문제 참조·blob purpose와 hash다.
export function contentHashOf(
  input: Pick<
    RecordProblemReportInput,
    "report" | "snapshot" | "group_key" | "existing_problem" | "blobs"
  >,
): Promise<string> {
  const { content_hash: _omitted, ...report } = input.report;
  return fingerprint({
    report,
    // 조립 시각은 재전송마다 달라진다. 같은 발생의 hash에는 넣지 않는다.
    snapshot: {
      ...input.snapshot,
      captured_at: report.observed_at,
    },
    group_key: input.group_key,
    existing_problem: input.existing_problem,
    blobs: input.blobs.map((blob) => ({
      purpose: blob.purpose,
      hash: blob.hash,
    })),
  });
}

// 대기 큐. 개수·바이트 한도를 넘는 새 입력은 실패와 손실 이유다.
// entry는 send가 끝난 뒤에만 빠진다: 재전송은 같은 고정 input만 쥔다.
export type CollectorPending = {
  bytes: number;
  input: Readonly<RecordProblemReportInput>;
};

export function utf8Length(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function queueRejection(overCount: boolean): ReportTransportError {
  return {
    code: "unavailable",
    message: overCount
      ? "collector queue is full"
      : "collector queue byte limit exceeded",
  };
}

export function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function createCollectorQueue(options: {
  pending_count: number;
  pending_bytes: number;
}) {
  const pending = new Map<string, CollectorPending>();
  let heldBytes = 0;
  return {
    get size() {
      return pending.size;
    },
    get bytes() {
      return heldBytes;
    },
    // 한도 안이면 넣고, 넘으면 손실 이유를 돌려준다.
    admit(
      reportId: string,
      input: Readonly<RecordProblemReportInput>,
    ): ReportTransportError | undefined {
      const bytes = utf8Length(input);
      const overCount = pending.size >= options.pending_count;
      const overBytes = heldBytes + bytes > options.pending_bytes;
      if (overCount || overBytes) return queueRejection(overCount);
      pending.set(reportId, { bytes, input });
      heldBytes += bytes;
      return undefined;
    },
    release(reportId: string): void {
      const held = pending.get(reportId);
      if (held) {
        pending.delete(reportId);
        heldBytes -= held.bytes;
      }
    },
    // 재전송은 같은 고정 input만 다시 보낸다. 새 조립이 없다.
    held(reportId: string): Readonly<RecordProblemReportInput> | undefined {
      return pending.get(reportId)?.input;
    },
  };
}

// 같은 고정 input으로 unavailable·response_lost만 다시 보낸다. snapshot은
// 다시 조립하지 않는다: 첫 시도 뒤 최대 3회, 등록 간격(250·1,000·3,000ms)으로
// sleep하고 첫 send 전에는 자지 않는다.
export async function deliverReport(
  send: () => Promise<Result<ReportAcceptance>>,
  retry: { delays: readonly number[] },
  sleep: (ms: number) => Promise<void>,
  lost: string,
): Promise<ReportCompletion> {
  const attempts = retry.delays.length + 1;
  let last: ReportTransportError = {
    code: "unavailable",
    message: "report was not sent",
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(retry.delays[attempt - 1]);
    try {
      const result = await send();
      if (result.ok) return { status: "accepted", acceptance: result.value };
      last = { code: result.error.code, message: result.error.message };
    } catch {
      last = { code: "response_lost", message: lost };
    }
    if (!isRetryableReportError(last)) break;
  }
  return { status: "failed", reason: last };
}
