// context API 읽기: context.search·saved_views. 검색은 주입된 SearchExecutor가 돌리고 읽기는 입력을
// 선언에 맞춰 검사하고 결과를 page로 자른다.
import { canonicalize, err, ok } from "../../../../base/mod.ts";
import {
  SEARCH_PAGE_SIZE_DEFAULT,
  SEARCH_PAGE_SIZE_MAX,
} from "../../../../protocol/projects/mod.ts";
import { resolveInputs } from "../search/inputs.ts";
import type { ContextApiReadDeps, ContextApiReads } from "./reads.ts";
import {
  appliedBundleOf,
  checkReader,
  common,
  compareText,
  decodeCursor,
  encodeCursor,
  invalidInput,
  notFound,
  parseContent,
  searchableOf,
} from "./reads-common.ts";
import type { ContextApiState } from "./state.ts";

type Handlers = Pick<ContextApiReads, "contextSearch" | "contextSavedViews">;

export function createSearchReads(
  state: ContextApiState,
  deps: ContextApiReadDeps,
): Handlers {
  const contextSearch: Handlers["contextSearch"] = ({ actor, input }) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    // 보관된 context와 아직 판이 없는 context의 검색은 닫혀 있다. index를 갱신하지 못했으면 빈 결과로
    // 꾸미지 않는다.
    const target = searchableOf(state, input.context);
    if (!target.ok) return target;
    const { context, applied, content } = target.value;

    const declared = content.searches.find((search) =>
      search.name === input.search
    );
    if (declared === undefined) {
      return invalidInput(`search ${input.search} is not declared`);
    }
    const resolved = resolveInputs(declared, input.inputs);
    if (!resolved.ok) {
      return invalidInput(
        `input ${
          resolved.error.input ?? ""
        } does not fit the declaration (${resolved.error.code})`,
      );
    }
    const pageSize = input.page_size ?? declared.result.page_size ??
      SEARCH_PAGE_SIZE_DEFAULT;
    if (
      !Number.isInteger(pageSize) || pageSize < 1 ||
      pageSize > SEARCH_PAGE_SIZE_MAX
    ) {
      return invalidInput(`page_size must be 1-${SEARCH_PAGE_SIZE_MAX}`);
    }

    // cursor는 (검색, 입력)과 판에 묶인다. 다른 검색이나 입력은 invalid_input, 판이 바뀌었으면 conflict다.
    const scope = { search: input.search, inputs: resolved.inputs };
    let offset = 0;
    if (input.cursor !== undefined) {
      const payload = decodeCursor(input.cursor);
      if (
        payload === null || typeof payload.offset !== "number" ||
        !Number.isInteger(payload.offset) || payload.offset < 0 ||
        typeof payload.bundle !== "string" ||
        canonicalize(payload.scope) !== canonicalize(scope)
      ) {
        return invalidInput("cursor does not belong to this search call");
      }
      if (payload.bundle !== applied.id) {
        return err({
          code: "conflict",
          message: "the applied bundle changed since this cursor was made",
        });
      }
      offset = payload.offset;
    }

    const all = deps.execute(
      state.entities.get(context.id) ?? [],
      applied.content,
      input.search,
      resolved.inputs,
    );
    const rows = all.slice(offset, offset + pageSize);
    const complete = offset + rows.length >= all.length;
    return ok({
      context: context.id,
      search: input.search,
      bundle_hash: applied.bundle_hash!,
      total: all.length,
      rows: [...rows],
      as_of_seq: String(state.seq),
      complete,
      next_cursor: complete ? null : encodeCursor({
        scope,
        bundle: applied.id,
        offset: offset + rows.length,
      }),
    });
  };

  const contextSavedViews: Handlers["contextSavedViews"] = (
    { actor, input },
  ) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    const context = state.contexts.get(input.context);
    if (context === undefined) return notFound("context", input.context);
    // 적용된 판이 더는 돌릴 수 없는 호출은 지우지 않고 broken으로 표시한다.
    const applied = appliedBundleOf(state, context);
    const content = applied === null ? null : parseContent(applied);
    if (content !== null && !content.ok) return content;
    const searches = content?.value.searches ?? [];
    const views = [...state.views.values()]
      .filter((view) => view.context === context.id)
      .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id))
      .map((view) => {
        const declared = searches.find((search) => search.name === view.search);
        const broken = declared === undefined ||
          !resolveInputs(declared, view.inputs).ok;
        return { ...view, broken };
      });
    return ok({ context: context.id, views, ...common(state) });
  };

  return { contextSearch, contextSavedViews };
}
