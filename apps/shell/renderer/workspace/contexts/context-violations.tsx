// Violations: 계약을 어긴 문서를 줄마다 파일 이름·무엇이 어긋났는지·어긴 규칙 한 줄·
// [Send to Context Engineer]로 보이고 위에 [Send all to Context Engineer]를 둔다(shell/workspace#R19).
// 이미 넘긴 줄은 "Context Engineer is on it", 위반이 없으면 "No violations."만. 구현은 ctx-I44.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.violations-send
//   contexts.button.violations-send-all
//   contexts.empty.violations-none
//   contexts.error.violations-send-failed
//   contexts.label.violations-on-it
//   contexts.label.violations-rule
//   common.error.load-failed
import type { ReactNode } from "react";

import type { ContextsSource } from "./source.ts";
import type { OpenDocument } from "./shared.ts";

export interface ContextViolationsProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 파일 이름을 누르면 그 문서 탭을 연다. */
  readonly onOpenDocument: OpenDocument;
}

export function ContextViolations(_props: ContextViolationsProps): ReactNode {
  return null;
}
