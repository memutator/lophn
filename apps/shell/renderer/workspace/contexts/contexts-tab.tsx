// Contexts 탭: 이 프로젝트의 context를 카드로 나열한다(shell/workspace#R16). 카드마다 이름·목적·
// 다루는 것의 종류 수·적용된 판과 검사 결과·위반 수·쓰는 Operator 수와 [Open]을 보이고 아래에
// [New context]를 둔다. 구현은 ctx-I40.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.tab-new-context
//   contexts.button.tab-open
//   contexts.empty.tab-none
//   contexts.label.tab-kinds
//   contexts.label.tab-no-violations
//   contexts.label.tab-operators
//   contexts.label.tab-version-checking
//   contexts.label.tab-version-failed
//   contexts.label.tab-version-none
//   contexts.label.tab-version-passed
//   contexts.label.tab-violations
//   contexts.note.tab-new-context
//   contexts.title.tab-screen
//   common.error.load-failed
import type { ReactNode } from "react";

import type { ContextsSource } from "./source.ts";

export interface ContextsTabProps {
  /** "Contexts in phroner"처럼 제목에 쓰는 프로젝트 이름. */
  readonly projectTitle: string;
  readonly project: string;
  readonly source: ContextsSource;
  /** [Open]. context ID를 넘긴다. */
  readonly onOpenContext: (context: string) => void;
  /** [New context]. 폼을 열지 않고 Context Engineer와의 Agent 탭을 여는 일은 부른 쪽의 몫이다. */
  readonly onNewContext: () => void;
}

export function ContextsTab(_props: ContextsTabProps): ReactNode {
  return null;
}
