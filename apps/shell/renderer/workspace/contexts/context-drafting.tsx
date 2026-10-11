// 만드는 중(drafting) context의 탭 본문: "Context Engineer is drafting · step n of 4", 단계 목록,
// 흐린 초안 개체(shell/workspace#R30). 하위 탭은 같은 다섯 개이고 첫 판이 적용되기 전에는
// Overview 밖이 안내 글만 보인다. 구현은 ctx-I41.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.heading.drafting-overview
//   contexts.label.drafting-apply
//   contexts.label.drafting-checks
//   contexts.label.drafting-chip
//   contexts.label.drafting-draft
//   contexts.label.drafting-progress
//   contexts.label.drafting-read
//   contexts.label.drafting-reading
//   contexts.label.drafting-status
//   contexts.note.drafting-later
//   contexts.note.drafting-not-final
//   contexts.label.frame-chip
//   contexts.label.sub-contract
//   contexts.label.sub-glossary
//   contexts.label.sub-overview
//   contexts.label.sub-search
//   contexts.label.sub-violations
//   contexts.label.sub-violations-count
import type { ReactNode } from "react";

import type { ContextsSource } from "./source.ts";

export interface ContextDraftingProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
}

export function ContextDrafting(_props: ContextDraftingProps): ReactNode {
  return null;
}
