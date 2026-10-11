// Search 탭(shell/workspace#R23, R27): 왼쪽에 context 고르기 · "Open context" · 그 context의 선언된
// 검색 · Saved views, 본문에 고른 검색의 입력 form(SearchInputForm)과 결과(SearchResults).
// 탭이 들고 저장되는 값(state)은 부른 쪽이 가진다. 구현은 ctx-I49.
import type { ReactNode } from "react";

import type { ContextsSource, SearchInputValues } from "./source.ts";
import type { OpenDocument } from "./shared.ts";

/** layout에 저장되는 search 탭 값과 같은 모양(domain-model shell/workspace TabLayout). */
export interface SearchTabState {
  /** context ID. */
  readonly context: string;
  /** 고른 선언된 검색 이름. 아직 안 골랐으면 null. */
  readonly search: string | null;
  readonly inputs: SearchInputValues;
  /** 0부터. */
  readonly page: number;
  /** 저장한 보기로 열었으면 그 `viw` ID. */
  readonly savedView: string | null;
}

export interface SearchTabProps {
  readonly project: string;
  readonly source: ContextsSource;
  readonly state: SearchTabState;
  readonly onState: (next: SearchTabState) => void;
  /** "Open context" 링크와 선언된 검색이 없을 때의 [Open context]. */
  readonly onOpenContext: (context: string) => void;
  readonly onOpenDocument: OpenDocument;
  /** 그릴 수 없는 입력 타입일 때의 [Ask Context Engineer]. */
  readonly onAsk: () => void;
}

export function SearchTab(_props: SearchTabProps): ReactNode {
  return null;
}
