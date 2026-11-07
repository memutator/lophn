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
export interface HighlightOptions {
  /** 자라는 같은 block의 요청을 묶는 key. 같은 key면 앞서 칠한 줄을 다시 칠하지 않아도 된다. */
  readonly key?: string;
  /** true면 아직 쓰는 중인 마지막 줄은 뺀다. 낸 줄은 code의 마지막 "\n" 앞까지다. */
  readonly partial?: boolean;
}
export interface Highlighter {
  /** code를 줄마다 token으로 낸다. 모르는 언어나 실패, 너무 큰 code는 null이다(plain으로 그린다). */
  highlight(
    code: string,
    language: string,
    options?: HighlightOptions,
  ): Promise<readonly CodeLine[] | null>;
}

const HighlighterContext = createContext<Highlighter | null>(null);

// CodeBlock에 highlighter를 준다. 없으면 code는 plain이다.
export const HighlighterProvider = HighlighterContext.Provider;

export function useHighlighter(): Highlighter | null {
  return useContext(HighlighterContext);
}
