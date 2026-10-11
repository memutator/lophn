// Overview: context가 다루는 것마다 카드(이름·한 줄 뜻·개수·가진 것·예시 문서·"See all"), 카드 사이
// 사람 말 화살표, 아래에 ContextComposition(shell/workspace#R18). 계약 말(kind·public·검색 함수)은
// 쓰지 않는다. 구현은 ctx-I42.
import type { ReactNode } from "react";

import type { ContextsSource } from "./source.ts";
import type { OpenDocument } from "./shared.ts";

export interface ContextOverviewProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 예시 문서 이름을 누르면. */
  readonly onOpenDocument: OpenDocument;
  /** "See all 13 →". 개체 종류 이름을 넘긴다. */
  readonly onSeeAll: (type: string) => void;
}

export function ContextOverview(_props: ContextOverviewProps): ReactNode {
  return null;
}
