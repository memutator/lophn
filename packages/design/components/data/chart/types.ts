import type { StatusTone } from "../../../tokens.ts";

// 앱 화면과 세션 시각 블록이 같은 모양으로 넘기는 선언형 차트 입력. 함수·식·HTML을 받지 않는다.

export interface Series {
  // 엔티티의 안정된 key. 색은 domain 안의 이 key 자리로 정한다.
  readonly key: string;
  readonly label: string;
  // x(또는 범주) 하나에 값 하나. null은 값이 없는 자리다.
  readonly values: readonly (number | null)[];
}

export interface ScatterPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScatterGroup {
  readonly key: string;
  readonly label: string;
  readonly points: readonly ScatterPoint[];
}

// 상태 값의 뜻은 component가 모른다. 넘겨받은 이름과 tone을 아이콘과 글로 보일 뿐이다.
export interface NodeStatus {
  readonly label: string;
  readonly tone: StatusTone;
}

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly status?: NodeStatus;
  // 짧은 글. 길면 줄여 보이고 전체는 tooltip으로 읽는다.
  readonly note?: string;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

// 0–7은 tokens.chart.series의 자리, other는 9번째부터 합친 기타 회색이다.
export type Slot = number | "other";
