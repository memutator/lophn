// 허락된 보류 request를 적용한다. applier는 그 종류의 소유 module이 등록하고 intent를 다시 검사해 실행한다.
// 결과는 recordApplied로 남고, 그때 ApprovalDecided가 나간다. 접수(allow)와 적용 결과(applied)는 따로 보인다.
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  ApplyResult,
  PendingApproval,
} from "../../protocol/approvals/mod.ts";
import type { ApprovalLedger } from "./ledger.ts";
import type { ApprovalApplier } from "./ports.ts";

type Kind = "activation" | "reaction";

function failed(
  error: {
    code: Extract<ApplyResult, { state: "failed" }>["code"];
    message: string;
  },
): ApplyResult {
  return { state: "failed", code: error.code, message: error.message };
}

export function createApplier(deps: { ledger: ApprovalLedger }) {
  const appliers = new Map<Kind, ApprovalApplier>();
  // 같은 request를 동시에 두 번 적용하지 않는다.
  const running = new Set<string>();

  async function run(request: PendingApproval): Promise<ApplyResult> {
    const applier = appliers.get(request.intent.kind as Kind);
    if (applier === undefined) {
      return failed({
        code: "unavailable",
        message: `no applier is registered for ${request.intent.kind}`,
      });
    }
    let result: Result<ApplyResult>;
    try {
      result = await applier(request);
    } catch {
      result = err({ code: "internal", message: "the applier threw" });
    }
    return result.ok ? result.value : failed(result.error);
  }

  async function applyOne(request: PendingApproval): Promise<Result<void>> {
    if (running.has(request.id)) return ok(undefined);
    running.add(request.id);
    try {
      const recorded = await deps.ledger.recordApplied(
        request.id,
        await run(request),
      );
      // conflict는 다른 길이 이미 결과를 남긴 것이다.
      if (!recorded.ok && recorded.error.code !== "conflict") return recorded;
      return ok(undefined);
    } finally {
      running.delete(request.id);
    }
  }

  return {
    register(kind: Kind, applier: ApprovalApplier): void {
      appliers.set(kind, applier);
    },
    // 두 번 불려도 효과는 한 번이다: 결과가 아직 없는 request만 적용한다.
    async apply(request: PendingApproval): Promise<Result<void>> {
      const waiting = await deps.ledger.unapplied();
      if (!waiting.ok) return waiting;
      const current = waiting.value.find((one) => one.id === request.id);
      return current === undefined ? ok(undefined) : applyOne(current);
    },
    // 허락됐는데 결과가 없는 request를 다시 적용한다. 꺼졌다 켜질 때 부른다.
    async resume(): Promise<Result<number>> {
      const waiting = await deps.ledger.unapplied();
      if (!waiting.ok) return waiting;
      for (const request of waiting.value) {
        const done = await applyOne(request);
        if (!done.ok) return done;
      }
      return ok(waiting.value.length);
    },
  };
}
