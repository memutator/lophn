// activation 판정. 계기는 앱 workspace session의 `release.activate`(driver의 `activate`)이고, 선언이 넓어지거나
// data 손실 migration이 있거나 첫 activation일 때만 사람에게 묻는다(동의 표, consents.ts). 묻지 않으면 그 앱의 activation을
// 곧바로 시작한다. 사람이 허락하면 driver sweep이 허락한 줄을 `consented`로 넘겨 시작한다.
// 앱에 이미 돌고 있는 activation이 있으면 conflict다. 일하는 것은 driver다(assembly.ts). 이 file은 판정만 하고 IO는 deps로 받는다.
import { canonicalize, ok, type Result } from "../../../../base/mod.ts";
import type {
  ActivationComparison,
  ReleaseRecord,
} from "../../../../protocol/apps/mod.ts";
import { asksFor } from "../compare.ts";

type ActivationHandlerDeps = {
  releases: {
    get(id: string): Result<ReleaseRecord | null>;
    // 지금 active grant·active release와 견준 비교.
    comparison(release: ReleaseRecord): Promise<Result<ActivationComparison>>;
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

export function createActivationHandlers(deps: ActivationHandlerDeps): {
  // 비교를 보고 시작하거나 묻는다.
  activate(
    release: ReleaseRecord,
  ): Promise<Result<"started" | "waiting_consent">>;
  // 사람이 허락한 줄을 시작한다. 허락한 뒤 비교가 달라졌으면 시작하지 않고 다시 묻는다.
  consented(row: {
    release: string;
    comparison: string;
  }): Promise<Result<void>>;
  // 시작하기 전에 다시 판정한다. 허락한 비교와 달라졌을 때 driver가 부른다.
  reconsider(release: ReleaseRecord): Promise<Result<void>>;
} {
  // 같은 비교의 동의 줄은 하나라서(consents.ask) 두 번 불러도 줄이 늘지 않는다.
  async function activate(
    release: ReleaseRecord,
  ): Promise<Result<"started" | "waiting_consent">> {
    const comparison = await deps.releases.comparison(release);
    if (!comparison.ok) return comparison;
    if (!asksFor(comparison.value)) {
      const queued = deps.enqueue(release.app, release.id, null);
      return queued.ok ? ok("started") : queued;
    }
    const asked = await deps.consents.ask(release, comparison.value);
    return asked.ok ? ok("waiting_consent") : asked;
  }

  return {
    activate,
    async reconsider(release) {
      const done = await activate(release);
      return done.ok ? ok(undefined) : done;
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
        const done = await activate(found.value);
        return done.ok ? ok(undefined) : done;
      }
      return deps.enqueue(
        found.value.app,
        found.value.id,
        asksFor(comparison.value) ? canonicalize(comparison.value) : null,
      );
    },
  };
}
