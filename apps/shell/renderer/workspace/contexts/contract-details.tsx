// Contract: "Details for Context Engineer and the curious" 아래에 개체 관계 그림, 개체마다 카드
// (이름·public·kind와 경로·문서 수·field와 관계), 선언된 검색마다 이름과 예시 검사 결과
// (shell/workspace#R21). 판 번호·단추가 있는 머리는 ContextFrame의 몫이다. 구현은 ctx-I46.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.heading.contract-fields
//   contexts.heading.contract-relations
//   contexts.heading.contract-searches
//   contexts.label.contract-diagram
//   contexts.label.contract-documents
//   contexts.label.contract-examples-fail
//   contexts.label.contract-examples-pass
//   contexts.label.contract-field-section
//   contexts.label.contract-field-values
//   contexts.label.contract-kind
//   contexts.label.contract-public
//   contexts.label.contract-relation
//   common.error.load-failed
import type { ReactNode } from "react";

import type { ContextsSource } from "./source.ts";

export interface ContractDetailsProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
}

export function ContractDetails(_props: ContractDetailsProps): ReactNode {
  return null;
}
