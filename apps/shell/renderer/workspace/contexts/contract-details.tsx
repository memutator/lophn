// Contract: "Details for Context Engineer and the curious" 아래에 개체 관계 그림, 개체마다 카드
// (이름·public·kind와 경로·문서 수·field와 관계), 선언된 검색마다 이름과 예시 검사 결과
// (shell/workspace#R21). 판 번호·단추가 있는 머리는 ContextFrame의 몫이다. 구현은 ctx-I46.
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
