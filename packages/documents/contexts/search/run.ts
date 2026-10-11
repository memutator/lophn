// 선언 검색 하나를 실행한다: 입력 → follow → 조건 → 순서 → table page 또는 board.
import type { RunSearchArgs, SearchResult } from "./types.ts";

export function runSearch(_args: RunSearchArgs): SearchResult {
  return { ok: false, error: { code: "search_unknown" } };
}
