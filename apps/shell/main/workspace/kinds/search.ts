// search 탭 kind. context 하나의 선언된 검색을 채운 입력으로 연다(shell/workspace#R23). 입력은
// 사람이 채운 조건일 뿐이라 현재 보기에는 넣지 않고 복원 때 검색을 다시 계산한다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import {
  contextId,
  idOf,
  savedViewId,
  searchInputs,
  tabKey,
} from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("search"),
  key: tabKey,
  context: contextId,
  declared_search: z.string().min(1).max(128).nullable().default(null),
  inputs: searchInputs.default({}),
  page: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  saved_view: savedViewId.nullable().default(null),
});

export type SearchLayout = z.infer<typeof layout>;
export type SearchHint = {
  kind: "search";
  key: string;
  context: string;
  declared_search?: string;
};
export type SearchView = {
  kind: "search";
  key: string;
  context: string;
  declared_search?: string;
  selected: boolean;
};

export const searchKind = defineTabKind<SearchLayout, SearchHint, SearchView>({
  kind: "search",
  layout,
  // context가 없어졌거나 선언된 검색이 계약에서 사라졌으면 이유를 가진 자리표시다(R6).
  async restore(tab, targets) {
    if (!(await targets.context(tab.context))) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.context,
        reason: "context_missing",
      };
    }
    if (
      tab.declared_search !== null &&
      !(await targets.declaredSearch(tab.context, tab.declared_search))
    ) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.declared_search,
        reason: "search_missing",
      };
    }
    return { kind: "tab", tab };
  },
  hint(raw, key) {
    const context = idOf("ctx", raw.context);
    if (context === null) return null;
    const search = raw.declared_search;
    return {
      kind: "search",
      key,
      context,
      ...(typeof search === "string" && search.length > 0 &&
          search.length <= 80
        ? { declared_search: search }
        : {}),
    };
  },
  scope(hint, reads) {
    reads.allow("context", hint.context, "contexts", {
      context: hint.context,
    });
  },
  view(hint, selected, ctx) {
    if (!ctx.refOk(hint.key) || !ctx.refOk(hint.context)) return null;
    if (!ctx.scope.allows("context", hint.context)) return null;
    return {
      kind: hint.kind,
      key: hint.key,
      context: hint.context,
      ...(hint.declared_search === undefined
        ? {}
        : { declared_search: ctx.truncate(hint.declared_search) }),
      selected,
    };
  },
  describe: (view) =>
    view.declared_search === undefined
      ? view.context
      : `${view.context} ${view.declared_search}`,
});
