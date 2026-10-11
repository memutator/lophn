// 선언된 검색의 결과(shell/workspace#R25, R26): 선언이 정한 대로 표 또는 board, 결과 개수와 지금 보는
// 범위("1–5 of 14"), 이전·다음과 page 번호. 개체 이름(F-009, exp-008)은 링크이고 누르면 그
// 문서 탭을 연다. 구현은 ctx-I48.
import type { ReactNode } from "react";

import type { DeclaredSearch, SearchRow } from "./source.ts";
import type { OpenDocument } from "./shared.ts";

export interface SearchResultsProps {
  readonly search: DeclaredSearch;
  /** 지금 page의 줄. */
  readonly rows: readonly SearchRow[];
  /** 0부터. */
  readonly page: number;
  readonly pageSize: number;
  /** 결과 전체 개수. */
  readonly total: number;
  readonly onPage: (page: number) => void;
  readonly onOpenDocument: OpenDocument;
}

export function SearchResults(_props: SearchResultsProps): ReactNode {
  return null;
}
