// 문서 탭 Info › Contexts: 이 문서가 들어 있는 context를 이름과 [Open]으로 나열한다
// (shell/workspace#R28). 하나도 없으면 비었음 글. 구현은 ctx-I50.
import type { ReactNode } from "react";

import type { ContextsSource } from "./source.ts";

export interface DocumentContextsProps {
  readonly source: ContextsSource;
  readonly project: string;
  /** project 폴더 기준 상대 경로. */
  readonly path: string;
  /** [Open]. context ID를 넘긴다. */
  readonly onOpenContext: (context: string) => void;
}

export function DocumentContexts(_props: DocumentContextsProps): ReactNode {
  return null;
}
