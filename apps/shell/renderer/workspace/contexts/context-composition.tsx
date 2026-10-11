// Composition 트리: 개체마다 어느 자료(경로 포함)로 이루어지고 무엇을 가지며 무엇과 이어지는지
// (shell/workspace#R18). 경로는 보이고 계약 말은 쓰지 않는다. 구현은 ctx-I43.
import type { ReactNode } from "react";

import type { ContextsSource } from "./source.ts";

export interface ContextCompositionProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
}

export function ContextComposition(_props: ContextCompositionProps): ReactNode {
  return null;
}
