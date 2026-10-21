// activation을 여는 Reactor handler와 동의 뒤 판정. `TicketVerified`가 계기이고, 선언이 넓어지거나
// data 손실 migration이 있을 때만 사람에게 묻는다(동의 표, consents.ts). 묻지 않으면 그 앱의 activation을 곧바로 시작하고,
// 사람이 허락하면 driver sweep이 허락한 줄을 `consented`로 넘긴다.
// 다른 domain이 쓰는 공개 tool을 지우는 release는 묻기 전에 막는다(release는 prepared로 남는다).
// 앱에 이미 돌고 있는 activation이 있으면 conflict다. 일하는 것은 driver다(assembly.ts). 이 file은 판정만 하고 IO는 deps로 받는다.
import { canonicalize, ok, type Result } from "../../../../base/mod.ts";
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
    // 다른 domain이 쓰는 공개 tool을 지우는 release면 true다(막기만 한다. 알리지 않는다). 읽지 못하면 err이고 시작하지 않는다.
    blocked(release: ReleaseRecord): Promise<Result<boolean>>;
  };
  consents: {
    // 사람에게 묻는다. 같은 비교로 다시 부르면 줄이 늘지 않는다.
    ask(
      release: ReleaseRecord,
      comparison: ActivationComparison,
    ): Promise<Result<void>>;
  };
  // approved는 사람이 허락한 비교의 정규 값이다. 묻지 않고 시작한 것은 null이다.
  enqueue(app: string, release: string, approved: string | null): Result<void>;
};

const TICKET_VERIFIED_HANDLER = "activation.ticket-verified";

export function createActivationHandlers(deps: ActivationHandlerDeps): {
  ticketVerified: ReactorHandler<"TicketVerified">;
  // 사람이 허락한 줄을 시작한다. 허락한 뒤 비교가 달라졌으면 시작하지 않고 다시 묻는다.
  consented(
    row: { release: string; comparison: string },
  ): Promise<Result<void>>;
  // 시작하기 전에 다시 판정한다. 허락한 비교와 달라졌을 때 driver가 부른다.
  reconsider(release: ReleaseRecord): Promise<Result<void>>;
} {
  // 비교를 보고 시작하거나 묻는다. 같은 비교의 동의 줄은 하나라서(consents.ask) 같은 event를
  // 두 번 처리해도 줄이 늘지 않는다.
  async function judge(release: ReleaseRecord): Promise<Result<void>> {
    const blocked = await deps.releases.blocked(release);
    if (!blocked.ok) return blocked;
    if (blocked.value) return ok(undefined);
    const comparison = await deps.releases.comparison(release);
    if (!comparison.ok) return comparison;
    if (!asksFor(comparison.value)) {
      return deps.enqueue(release.app, release.id, null);
    }
    return await deps.consents.ask(release, comparison.value);
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
        return await judge(found.value);
      },
    },
    async consented(row) {
      const found = deps.releases.get(row.release);
      if (!found.ok) return found;
      if (found.value === null || found.value.status !== "prepared") {
        return ok(undefined);
      }
      const comparison = await deps.releases.comparison(found.value);
      if (!comparison.ok) return comparison;
      // 허락한 비교와 달라졌으면 새로 판정한다.
      if (
        asksFor(comparison.value) &&
        canonicalize(comparison.value) !== row.comparison
      ) {
        return await judge(found.value);
      }
      const blocked = await deps.releases.blocked(found.value);
      if (!blocked.ok) return blocked;
      if (blocked.value) return ok(undefined);
      return deps.enqueue(
        found.value.app,
        found.value.id,
        asksFor(comparison.value) ? canonicalize(comparison.value) : null,
      );
    },
  };
}
