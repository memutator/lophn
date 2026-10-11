// Violations: 계약을 어긴 문서를 줄마다 파일 이름·무엇이 어긋났는지·어긴 규칙 한 줄·
// [Send to Context Engineer]로 보이고 위에 [Send all to Context Engineer]를 둔다(shell/workspace#R19).
// 이미 넘긴 줄은 "Context Engineer is on it", 위반이 없으면 "No violations."만. 구현은 ctx-I44.
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
