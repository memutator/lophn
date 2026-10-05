// 팔레트의 문서 묶음이 쓰는 documents 검색. 한 문서는 한 행으로 모으고 고르면 검색이
// 가리킨 판을 연다. 실패는 빈 목록이라 다른 묶음은 그대로 보인다.
import { EMPTY_CONDITIONS } from "../lophn-space/model.ts";
import type { LophnSource } from "../lophn-space/source.ts";
import type { DocumentSearch } from "./host.tsx";
import type { DocumentFound } from "./model.ts";

export function documentSearch(source: LophnSource): DocumentSearch {
  return async (query, place) => {
    const result = await source.search({ ...EMPTY_CONDITIONS, query, place });
    if (!result.ok) return [];
    const found = new Map<string, DocumentFound>();
    for (const hit of result.value.hits) {
      if (found.has(hit.document)) continue;
      found.set(hit.document, {
        document: hit.document,
        version: hit.version,
        title: hit.title,
        detail: hit.snippet.replace(/\s+/g, " ").trim(),
      });
    }
    return [...found.values()];
  };
}
