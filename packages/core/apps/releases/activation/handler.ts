// activation을 여는 Reactor handler 둘과 보류 request의 applier. `TicketVerified`가 계기이고, 선언이 넓어지거나
// data 손실 migration이 있을 때만 사람에게 묻는다(보류 request). 묻지 않거나 사람이 허락하면 그 앱의 줄에 세운다.
// 줄에서 일하는 것은 driver다(assembly.ts). 이 file은 판정만 하고 IO는 deps로 받는다.
import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import type {
  ApplyResult,
  Intent,
  PendingApproval,
} from "../../../../protocol/approvals/mod.ts";
import type {
  ActivationComparison,
  ReleaseRecord,
} from "../../../../protocol/apps/mod.ts";
import type { ReactorHandler } from "../../../events/ports.ts";
import { asksFor } from "../compare.ts";

type ActivationHandlerDeps = {
  releases: {
    // ticket에 이은 가장 새로 준비된 release.
    forTicket(ticket: string): Result<ReleaseRecord | null>;
    get(id: string): Result<ReleaseRecord | null>;
    // 지금 active grant·active release와 견준 비교.
    comparison(release: ReleaseRecord): Promise<Result<ActivationComparison>>;
  };
  approvals: {
    createPending(intent: Intent): Promise<Result<PendingApproval>>;
    // 결정된 request를 읽는다.
    request(id: string): Promise<Result<PendingApproval | null>>;
  };
  waitApproval(app: string, release: string, approval: string): void;
  // approved는 사람이 허락한 비교의 정규 값이다. 묻지 않고 세운 것은 null이다.
  enqueue(app: string, release: string, approved: string | null): void;
};

const TICKET_VERIFIED_HANDLER = "activation.ticket-verified";
const APPROVAL_DECIDED_HANDLER = "activation.approval-decided";

export function createActivationHandlers(deps: ActivationHandlerDeps): {
  ticketVerified: ReactorHandler<"TicketVerified">;
  approvalDecided: ReactorHandler<"ApprovalDecided">;
  applier: (request: PendingApproval) => Promise<Result<ApplyResult>>;
  // 줄에 세우기 전에 다시 판정한다. 허락한 비교와 달라졌을 때 driver가 부른다.
  reconsider(release: ReleaseRecord, seq: string): Promise<Result<void>>;
} {
  // 비교를 보고 줄에 세우거나 묻는다. 같은 intent의 보류 request는 하나라서(createPending) 같은 event를
  // 두 번 처리해도 request가 늘지 않는다.
  async function judge(
    release: ReleaseRecord,
    seq: string,
  ): Promise<Result<void>> {
    const comparison = await deps.releases.comparison(release);
    if (!comparison.ok) return comparison;
    if (!asksFor(comparison.value)) {
      deps.enqueue(release.app, release.id, null);
      return ok(undefined);
    }
    const pending = await deps.approvals.createPending({
      kind: "activation",
      actor: { kind: "program", seq },
      target: {
        kind: "activation",
        app: release.app,
        release: release.id,
      },
      effect: "read",
      input: comparison.value as unknown as Intent["input"],
      origin: { kind: "activation", app: release.app, release: release.id },
    } as Intent);
    if (!pending.ok) return pending;
    deps.waitApproval(release.app, release.id, pending.value.id);
    return ok(undefined);
  }

  return {
    reconsider: judge,
    ticketVerified: {
      name: TICKET_VERIFIED_HANDLER,
      async handle(event) {
        const found = deps.releases.forTicket(event.subject);
        if (!found.ok) return found;
        // 이은 release가 없거나 준비된 상태가 아니면(이미 활성 포함) 아무것도 하지 않는다.
        if (found.value === null || found.value.status !== "prepared") {
          return ok(undefined);
        }
        return await judge(found.value, event.seq);
      },
    },
    approvalDecided: {
      name: APPROVAL_DECIDED_HANDLER,
      async handle(event) {
        const { kind, decision, applied } = event.payload;
        // 거절이면 release는 prepared로 남고 App Engineer가 사람에게 올린다.
        if (kind !== "activation" || decision !== "allow") {
          return ok(undefined);
        }
        if (applied?.state !== "applied") return ok(undefined);
        const request = await deps.approvals.request(event.subject);
        if (!request.ok) return request;
        const target = request.value?.intent.target;
        if (target?.kind !== "activation") return ok(undefined);
        const found = deps.releases.get(target.release);
        if (!found.ok) return found;
        if (found.value === null || found.value.status !== "prepared") {
          return ok(undefined);
        }
        const comparison = await deps.releases.comparison(found.value);
        if (!comparison.ok) return comparison;
        // 허락한 비교와 달라졌으면 새로 판정한다.
        if (
          asksFor(comparison.value) &&
          canonicalize(comparison.value) !==
            canonicalize(request.value!.intent.input)
        ) {
          return await judge(found.value, event.seq);
        }
        deps.enqueue(
          found.value.app,
          found.value.id,
          asksFor(comparison.value) ? canonicalize(comparison.value) : null,
        );
        return ok(undefined);
      },
    },
    // 허락을 적용하기 직전에 release가 아직 prepared인지 다시 본다. 줄에 세우는 일은 ApprovalDecided handler다.
    applier(request) {
      const target = request.intent.target;
      if (target.kind !== "activation") {
        return Promise.resolve(
          err({ code: "invalid_input", message: "not an activation" }),
        );
      }
      const found = deps.releases.get(target.release);
      if (!found.ok) return Promise.resolve(found);
      if (found.value === null || found.value.status !== "prepared") {
        return Promise.resolve(ok({
          state: "failed" as const,
          code: "conflict" as const,
          message: "the release is no longer waiting for activation",
        }));
      }
      return Promise.resolve(ok({ state: "applied" as const }));
    },
  };
}
