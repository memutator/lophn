// Glossary: 이 context의 용어와 뜻을 목록으로 보고, 사람이 추가·고침·지운다(shell/workspace#R20).
// 줄마다 누가(You / Context Engineer) 언제(2 days ago) 정했는지 보인다. 구현은 ctx-I45.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.glossary-add
//   contexts.button.glossary-add-term
//   contexts.button.glossary-cancel
//   contexts.button.glossary-delete
//   contexts.button.glossary-edit
//   contexts.button.glossary-save
//   contexts.empty.glossary-none
//   contexts.error.glossary-failed
//   contexts.label.glossary-by-agent
//   contexts.label.glossary-by-user
//   contexts.label.glossary-meaning
//   contexts.label.glossary-term
//   contexts.note.glossary-purpose
//   common.error.load-failed
// "2 days ago"는 wording의 formatRelativeTime으로 만든다.
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
