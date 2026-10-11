// Context 탭의 틀: 머리(이름·Context 표시·목적·판 줄·단추)와 하위 탭 Overview · Search ·
// Violations · Glossary · Contract(shell/workspace#R17, R21). 하위 탭 본문은 부른 쪽이
// renderPanel로 넣는다. 만드는 중인 context는 ContextDrafting을 그린다. 구현은 ctx-I41.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.frame-ask
//   contexts.button.frame-history
//   contexts.empty.frame-missing
//   contexts.label.frame-chip
//   contexts.label.frame-kept-up-to-date
//   contexts.label.frame-note
//   contexts.label.frame-sub-tabs
//   contexts.label.frame-version-checking
//   contexts.label.frame-version-failed
//   contexts.label.frame-version-passed
//   contexts.label.sub-contract
//   contexts.label.sub-glossary
//   contexts.label.sub-overview
//   contexts.label.sub-search
//   contexts.label.sub-violations
//   contexts.label.sub-violations-count
//   common.error.load-failed
// "applied 2 hours ago"는 wording의 formatRelativeTime으로 만든다.
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
