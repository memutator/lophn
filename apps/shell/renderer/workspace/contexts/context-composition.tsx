// Composition 트리: 개체마다 어느 자료(경로 포함)로 이루어지고 무엇을 가지며 무엇과 이어지는지
// (shell/workspace#R18). 경로는 보이고 계약 말은 쓰지 않는다. 구현은 ctx-I43.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.heading.composition-title
//   contexts.label.composition-documents
//   contexts.label.composition-folders
//   contexts.label.composition-from-section
//   contexts.label.composition-has
//   contexts.label.composition-link
//   contexts.label.composition-link-outside
//   contexts.label.composition-links
//   contexts.label.composition-uses
//   common.error.load-failed
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
