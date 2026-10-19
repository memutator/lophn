// search 탭 kind. project 키워드 검색이다. folder는 등록 폴더나 그 하위 폴더의 절대 경로다.
// 검색어는 사람이 채운 조건일 뿐이라 복원 때 검색을 다시 계산한다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("search"),
  key: tabKey,
  query: z.string().max(200).default(""),
  folder: z.string().min(1).max(4096).nullable().default(null),
});

type SearchLayout = z.infer<typeof layout>;
export const searchKind = defineTabKind<SearchLayout>({
  kind: "search",
  layout,
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
