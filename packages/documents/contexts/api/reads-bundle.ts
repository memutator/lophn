// context API 읽기: context.contract·draft. 화면이 적용된 판의 내용과 만드는 중인 판의 진행을 읽는다.
import { ok } from "../../../base/mod.ts";
import type { BundleSummary } from "../../../contracts/documents/mod.ts";
import type { ContextApiReads } from "./reads.ts";
import {
  appliedBundleOf,
  checkReader,
  common,
  currentBundleOf,
  notFound,
  parseContent,
} from "./reads-common.ts";
import type { BundleRow, ContextApiState } from "./state.ts";

type Handlers = Pick<ContextApiReads, "contextContract" | "contextDraft">;

function summaryOf(row: BundleRow): BundleSummary {
  const { content: _content, ...summary } = row;
  return summary;
}

export function createBundleReads(state: ContextApiState): Handlers {
  // 적용된 판의 내용이다. 보관된 context도 마지막으로 적용된 판을 보인다.
  const contextContract: Handlers["contextContract"] = ({ actor, input }) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    const context = state.contexts.get(input.context);
    if (context === undefined) return notFound("context", input.context);
    const applied = appliedBundleOf(state, context);
    if (applied === null) {
      return ok({
        context: context.id,
        bundle: null,
        bundle_hash: null,
        content: null,
        ...common(state),
      });
    }
    const content = parseContent(applied);
    if (!content.ok) return content;
    return ok({
      context: context.id,
      bundle: applied.id,
      bundle_hash: applied.bundle_hash,
      content: content.value,
      ...common(state),
    });
  };

  // 만드는 중(drafting)인 context의 진행이다. 단계는 판의 상태에서 정한다: 판이 없으면 1(읽기),
  // draft나 failed 판이면 2(초안), 검사 중이면 3(검사).
  const contextDraft: Handlers["contextDraft"] = ({ actor, input }) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    const context = state.contexts.get(input.context);
    if (context === undefined) return notFound("context", input.context);
    if (context.status !== "drafting") {
      return ok({ context: context.id, draft: null, ...common(state) });
    }
    const current = currentBundleOf(
      [...state.bundles.values()].filter((row) => row.context === context.id),
    );
    const draft = current === null
      ? { step: 1 as const, bundle: null, content: null, check: null }
      : {
        step: current.status === "checking" ? 3 as const : 2 as const,
        bundle: summaryOf(current),
        content: current.content,
        check: current.check === null
          ? null
          : state.checks.get(current.check) ?? null,
      };
    return ok({ context: context.id, draft, ...common(state) });
  };

  return { contextContract, contextDraft };
}
