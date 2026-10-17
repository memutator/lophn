// 시계열·막대·누적 막대·분포·산점 차트와 node·edge 도표. 계산은 d3-scale·d3-shape, 그리기는 React SVG다.
// 앱 화면과 세션 시각 블록이 같은 선언형 props를 넘긴다. 함수 식이나 HTML을 받지 않는다.
export {
  ALL_PAIRS_MAX,
  BarChart,
  type BarChartProps,
  type ChartLocaleProps,
  type ChartStateProps,
  DistributionChart,
  type DistributionChartProps,
  GraphDiagram,
  type GraphDiagramProps,
  type GraphEdge,
  type GraphNode,
  LineChart,
  type LineChartProps,
  ScatterChart,
  type ScatterChartProps,
  type ScatterGroup,
  type ScatterPoint,
  type Series,
  SLOT_COUNT,
} from "@lophn/ui/data";
