// report collector worker. core 감독이 띄우고 보고 접수 통로는 이 모듈이
// 조립한다(problems/reporting#R1, R2, R8, R16). credential에서 출처를 정하고,
// 본문 주장은 따르지 않는다. 대기 한도·retry 간격은 주입받고, packages/problems는
// platform을 import하지 않는다.
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { RequestContext } from "../../../packages/contracts/platform/mod.ts";
import type {
  RecordReportInput,
  ReportAcceptance,
  ReportCompletion,
  ReportTransportError,
} from "../../../packages/contracts/problems/mod.ts";
import {
  isRetryableReportError,
  REPORT_RETRY_DELAYS_MS,
  reportContentHashInputSchema,
} from "../../../packages/contracts/problems/mod.ts";

// collector 기본 한도(contracts/sdk-report REPORTING_LIMITS의 collector 값과 같다).
// 등록값으로 주입받는다.
export const COLLECTOR_CAPS = {
  pending_count: 128,
  pending_bytes: 16_777_216,
  concurrent_assembly: 4,
} as const;

// 접수 전송. transport 실패는 그대로 돌아가고 응답 유실은 response_lost다.
export type SendReport = (
  input: RecordReportInput,
) => Promise<Result<ReportAcceptance>>;

export type CollectorOptions = {
  send: SendReport;
  sleep: (ms: number) => Promise<void>;
  lost: string;
  // 없으면 COLLECTOR_CAPS다. 테스트가 작은 한도를 준다.
  caps?: {
    pending_count: number;
    pending_bytes: number;
    concurrent_assembly: number;
  };
  // 없으면 자동 실패 이유 없음이다. overflow는 unavailable 손실 이유다(R16).
  onOverQueue?: (reportId: string, reason: ReportTransportError) => void;
};

// credential 외의 출처는 없다(R1). 본문 actor·app·release·mode는 다시 쓰지 않는다.
export function originFrom(
  ctx: RequestContext,
  report: RecordReportInput["report"],
): Result<void> {
  if (ctx.actor !== "machine") {
    return err({ code: "forbidden", message: "collector credential이 아니다" });
  }
  if (report.principal !== ctx.principal) {
    return err({
      code: "forbidden",
      message: "principal이 credential과 다르다",
    });
  }
  return ok(undefined);
}

// content hash는 접수 내용에서 결정적으로 정한다(R9). 준비 handle·시각은 넣지 않는다.
// hash 입력 형식은 reportContentHashInputSchema가 정한다: Report 입력(content_hash
// 제외)·Snapshot 입력·group key·기존 문제 참조·blob purpose와 hash.
export function contentHashOf(
  input: Pick<
    RecordReportInput,
    "report" | "snapshot" | "group_key" | "existing_problem" | "blobs"
  >,
): string | undefined {
  const { content_hash: _omitted, ...report } = input.report;
  const parsed = reportContentHashInputSchema.safeParse({
    report,
    snapshot: input.snapshot,
    group_key: input.group_key,
    existing_problem: input.existing_problem,
    blobs: input.blobs.map((blob) => ({
      purpose: blob.purpose,
      hash: blob.hash,
    })),
  });
  if (!parsed.success) return undefined;
  return parsed.data as unknown as string;
}

// 다른 앱 제출은 거절한다(R2). credential의 app과 report.app가 같아야 한다.
export function appFromCredential(
  report: RecordReportInput["report"],
  app: string,
): Result<string> {
  if (report.app !== app) {
    return err({ code: "forbidden", message: "다른 앱의 보고다" });
  }
  return ok(app);
}

// 대기 큐. 개수·바이트 한도를 넘는 새 입력은 실패와 손실 이유다(R16).
// entry는 send가 끝난 뒤에만 빠진다: 재전송은 같은 고정 input만 쥔다.
export type CollectorPending = {
  bytes: number;
  input: Readonly<RecordReportInput>;
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

export function bodyOverLimit(body: unknown, limit: number): boolean {
  return utf8Length(body) > limit;
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
    // 한도 안이면 넣고, 넘으면 손실 이유를 돌려준다(R16).
    admit(
      reportId: string,
      input: Readonly<RecordReportInput>,
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
    // 재전송은 같은 고정 input만 다시 보낸다(R16). 새 조립이 없다.
    held(reportId: string): Readonly<RecordReportInput> | undefined {
      return pending.get(reportId)?.input;
    },
  };
}

// 같은 고정 input으로 unavailable·response_lost만 다시 보낸다(R16). snapshot은
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
