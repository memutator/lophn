// 시계열·막대·누적 막대·분포·산점 차트와 node·edge 도표(apps/sdk#R17). 계산은 d3-scale·d3-shape, 그리기는 React SVG다.
// 앱 화면과 세션 시각 블록이 같은 선언형 props를 넘긴다. 함수 식이나 HTML을 받지 않는다.
export { LineChart, type LineChartProps } from "./line-chart.tsx";
export { BarChart, type BarChartProps } from "./bar-chart.tsx";
export {
  DistributionChart,
  type DistributionChartProps,
} from "./distribution-chart.tsx";
export { ScatterChart, type ScatterChartProps } from "./scatter-chart.tsx";
export { GraphDiagram, type GraphDiagramProps } from "./graph-diagram.tsx";
export type { ChartLocaleProps, ChartStateProps } from "./chart-frame.tsx";
export type {
  GraphEdge,
  GraphNode,
  ScatterGroup,
  ScatterPoint,
  Series,
} from "./types.ts";
export { ALL_PAIRS_MAX, SLOT_COUNT } from "./palette.ts";
