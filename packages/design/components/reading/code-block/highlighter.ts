import { createContext, useContext } from "react";

/** highlight된 code 한 조각. color는 CSS 색 값이다(shell은 `var(--code-…)`를 준다). */
export interface CodeToken {
  readonly text: string;
  readonly color?: string;
  readonly italic?: boolean;
  readonly bold?: boolean;
  readonly underline?: boolean;
}
export type CodeLine = readonly CodeToken[];
export interface Highlighter {
  /** code 전체를 줄마다 token으로 낸다. 모르는 언어나 실패는 null이다(plain으로 그린다). */
  highlight(
    code: string,
    language: string,
  ): Promise<readonly CodeLine[] | null>;
}

const HighlighterContext = createContext<Highlighter | null>(null);

// CodeBlock에 highlighter를 준다. 없으면 code는 plain이다.
export const HighlighterProvider = HighlighterContext.Provider;

export function useHighlighter(): Highlighter | null {
  return useContext(HighlighterContext);
}
