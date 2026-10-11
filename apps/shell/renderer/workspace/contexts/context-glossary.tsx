// Glossary: 이 context의 용어와 뜻을 목록으로 보고, 사람이 추가·고침·지운다(shell/workspace#R20).
// 줄마다 누가(You / Context Engineer) 언제(2 days ago) 정했는지 보인다. 구현은 ctx-I45.
import type { ReactNode } from "react";

import type { ContextsSource } from "./source.ts";

export interface ContextGlossaryProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 새 항목의 `trm` ID를 만든다. */
  readonly newId: () => string;
  /** "2 days ago"를 재는 지금. 기본은 현재 시각. */
  readonly now?: Date;
}

export function ContextGlossary(_props: ContextGlossaryProps): ReactNode {
  return null;
}
