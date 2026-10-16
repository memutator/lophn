// search 탭 kind. 두 갈래다. `context`가 있으면 그 context의 선언된 검색을 채운 입력으로 열고,
// 없으면 project 키워드 검색이다. 입력과 검색어는 사람이 채운 조건일 뿐이라 현재 보기에는 넣지
// 않고 복원 때 검색을 다시 계산한다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { contextId, savedViewId, searchInputs, tabKey } from "./values.ts";

const declaredLayout = z.strictObject({
  kind: z.literal("search"),
  key: tabKey,
  context: contextId,
  declared_search: z.string().min(1).max(128).nullable().default(null),
  inputs: searchInputs.default({}),
  page: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  saved_view: savedViewId.nullable().default(null),
});

// 키워드 검색. folder는 등록 폴더나 그 하위 폴더의 절대 경로다.
const keywordLayout = z.strictObject({
  kind: z.literal("search"),
  key: tabKey,
  query: z.string().max(200).default(""),
  folder: z.string().min(1).max(4096).nullable().default(null),
});

const layout = z.union([declaredLayout, keywordLayout]);

type SearchLayout = z.infer<typeof layout>;
export const searchKind = defineTabKind<SearchLayout>({
  kind: "search",
  layout,
  // context가 없어졌거나 선언된 검색이 계약에서 사라졌으면 이유를 가진 자리표시다.
  async restore(tab, targets) {
    if (!("context" in tab)) return { kind: "tab", tab };
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
});
