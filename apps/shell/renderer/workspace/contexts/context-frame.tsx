// Context 탭의 틀: 머리(이름·Context 표시·목적·판 줄·단추)와 하위 탭 Overview · Search ·
// Violations · Glossary · Contract(shell/workspace#R17, R21). 하위 탭 본문은 부른 쪽이
// renderPanel로 넣는다. 만드는 중인 context는 ContextDrafting을 그린다. 구현은 ctx-I41.
import type { ReactNode } from "react";

import type { ContextsSource } from "./source.ts";
import type { SubTab } from "./shared.ts";

export interface ContextFrameProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 지금 고른 하위 탭. 바꾸는 일은 onSub로 부른 쪽이 한다. */
  readonly sub: SubTab;
  readonly onSub: (sub: SubTab) => void;
  /** 고른 하위 탭의 본문. */
  readonly renderPanel: (sub: SubTab) => ReactNode;
  /** 머리의 [Ask Context Engineer]. 하위 탭이 Overview가 아닐 때만 보인다. */
  readonly onAsk: () => void;
  /** 머리의 [History]. */
  readonly onHistory: () => void;
  /** "applied 2 hours ago"를 재는 지금. 기본은 현재 시각. */
  readonly now?: Date;
}

export function ContextFrame(_props: ContextFrameProps): ReactNode {
  return null;
}
