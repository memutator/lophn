// 만드는 중(drafting) context의 탭 본문: "Context Engineer is drafting · step n of 4", 단계 목록,
// 흐린 초안 개체(shell/workspace#R30). 하위 탭은 같은 다섯 개이고 첫 판이 적용되기 전에는
// Overview 밖이 안내 글만 보인다. 구현은 ctx-I41.
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
