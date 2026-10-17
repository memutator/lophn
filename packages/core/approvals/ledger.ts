// 보류 request 표에 닿는 길. Approvals는 이 port만 안다.
// 제품은 writer·reader로 등록된 command와 read를 부르고, 시험은 같은 handler를 임시 SQLite에서 직접 부른다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type ApplyResult,
  approvalsPending,
  type Intent,
  type PendingApproval,
} from "../../protocol/approvals/mod.ts";
import {
  approvalsCancelPendingFor,
  approvalsCreatePending,
  approvalsRecordApplied,
  approvalsRequest,
  approvalsUnapplied,
} from "./routes.ts";

export interface ApprovalLedger {
  createPending(
    intent: Intent,
  ): Promise<Result<{ request: PendingApproval; created: boolean }>>;
  cancelPendingFor(app: string, release?: string): Promise<Result<number>>;
  recordApplied(
    request: string,
    applied: ApplyResult,
  ): Promise<Result<PendingApproval>>;
  unapplied(): Promise<Result<PendingApproval[]>>;
  request(id: string): Promise<Result<PendingApproval | null>>;
  pending(): Promise<Result<PendingApproval[]>>;
}

// machine 자격으로 command와 read를 낸다. 결과는 route의 output 모양이다.
interface ApprovalCalls {
  command(name: string, input: unknown): Promise<Result<unknown>>;
  read(
    route: { resource: string; method: string },
    input: unknown,
  ): Promise<Result<unknown>>;
}

function shaped<T>(
  parsed: { success: true; data: T } | { success: false },
): Result<T> {
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "internal", message: "unexpected approval result shape" });
}

export function createApprovalLedger(calls: ApprovalCalls): ApprovalLedger {
  return {
    async createPending(intent) {
      const done = await calls.command(approvalsCreatePending.name, { intent });
      if (!done.ok) return done;
      const parsed = shaped(
        approvalsCreatePending.output.safeParse(done.value),
      );
      return parsed.ok ? ok(parsed.value) : parsed;
    },
    async cancelPendingFor(app, release) {
      const done = await calls.command(approvalsCancelPendingFor.name, {
        app,
        ...(release === undefined ? {} : { release }),
      });
      if (!done.ok) return done;
      const parsed = shaped(
        approvalsCancelPendingFor.output.safeParse(done.value),
      );
      return parsed.ok ? ok(parsed.value.cancelled) : parsed;
    },
    async recordApplied(request, applied) {
      const done = await calls.command(approvalsRecordApplied.name, {
        request,
        applied,
      });
      if (!done.ok) return done;
      const parsed = shaped(
        approvalsRecordApplied.output.safeParse(done.value),
      );
      return parsed.ok ? ok(parsed.value.request) : parsed;
    },
    async unapplied() {
      const done = await calls.read(approvalsUnapplied, {});
      if (!done.ok) return done;
      const parsed = shaped(approvalsUnapplied.output.safeParse(done.value));
      return parsed.ok ? ok(parsed.value.requests) : parsed;
    },
    async request(id) {
      const done = await calls.read(approvalsRequest, { request: id });
      if (!done.ok) return done;
      const parsed = shaped(approvalsRequest.output.safeParse(done.value));
      return parsed.ok ? ok(parsed.value.request) : parsed;
    },
    async pending() {
      const done = await calls.read(approvalsPending, {});
      if (!done.ok) return done;
      const parsed = shaped(approvalsPending.output.safeParse(done.value));
      return parsed.ok ? ok(parsed.value.requests) : parsed;
    },
  };
}
