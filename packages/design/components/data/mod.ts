// data: 표·목록·트리·차트처럼 data를 보이는 component.
// 행과 열을 보이는 기본 표. 정렬·페이지·열 고르기까지 필요하면 DataTable을 쓴다.
export { Table, type TableColumn, type TableProps } from "./table/table.tsx";
// Table의 행 밀도 type과 가상 scroll을 시작하는 행 수. 표 높이를 맞추는 쪽이 쓴다.
export { type Density, VIRTUALIZE_AFTER } from "./table/model.ts";
// Table 가상 scroll이 DOM에서 읽고 쓰는 것. test가 바꿔 끼운다.
export { domTableViewport, type TableViewport } from "./table/viewport.ts";
// 접고 펴는 계층 목록(파일·폴더). 키보드로 오가며 한 줄 목록이면 List를 쓴다.
export { Tree, type TreeProps } from "./tree/tree.tsx";
export type { TreeNode } from "./tree/model.ts";
// ListItem을 세로로 모으는 목록. 항목을 눌러 고르는 단순한 목록이다.
export { List } from "./list/list.tsx";
// 이름과 메타 한 줄을 가진 목록 항목. selected로 지금 항목을 보이고 계층이면 Tree다.
export { ListItem, type ListItemProps } from "./list/list.tsx";
// 숫자 하나와 변화량. 핵심 수치를 한눈에 볼 때 쓴다. 여러 개는 StatRow에 모은다.
export {
  type StatDirection,
  StatTile,
  type StatTileProps,
} from "./stat-tile/stat-tile.tsx";
// StatTile을 한 줄에 최대 4개씩 늘어놓는다. 좁은 칸에서는 2개씩이다.
export { StatRow } from "./stat-tile/stat-tile.tsx";
// 정렬·페이지·열 고르기와 상태(loading·error·empty)를 갖춘 표. 단순히 보이기만 하면 Table이다.
export { DataTable, type DataTableProps } from "./data-table/data-table.tsx";
// loading → error → empty → 내용 중 하나만 그린다. 표가 아닌 data 화면에도 쓴다.
export {
  DataState,
  type DataStateProps,
  type EmptySpec,
} from "./data-table/data-state.tsx";
// DataTable의 정렬·페이지·열 고르기 순수 규칙. 호출자가 정렬이나 페이지를 직접 가질 때 쓴다.
export {
  clampPage,
  pageCount,
  type PageSlice,
  pageSlice,
  type SortDirection,
  sortRows,
  type SortState,
  toggleColumn,
  visibleColumns,
} from "./data-table/model.ts";
// 시간에 따른 값의 변화. 시계열이 아니라 범주끼리 비교하면 BarChart다.
export { LineChart, type LineChartProps } from "./chart/line-chart.tsx";
// 범주별 값 비교(누적 가능). 값의 분포를 구간으로 나눠 보이려면 DistributionChart다.
export { BarChart, type BarChartProps } from "./chart/bar-chart.tsx";
// 잰 값들의 분포를 구간별 수로 보인다. 이미 범주로 나뉜 값은 BarChart다.
export {
  DistributionChart,
  type DistributionChartProps,
} from "./chart/distribution-chart.tsx";
// 두 값의 관계를 점으로 본다. 3계열까지만 그리므로 더 많으면 표 보기로 읽는다.
export {
  ScatterChart,
  type ScatterChartProps,
} from "./chart/scatter-chart.tsx";
// node와 edge의 연결 구조. 값의 크기가 아니라 관계를 보일 때 쓴다.
export {
  GraphDiagram,
  type GraphDiagramProps,
} from "./chart/graph-diagram.tsx";
export type {
  ChartLocaleProps,
  ChartStateProps,
} from "./chart/chart-frame.tsx";
export type {
  GraphEdge,
  GraphNode,
  ScatterGroup,
  ScatterPoint,
  Series,
} from "./chart/types.ts";
// 차트 색 slot 수와 산점의 계열 상한. 차트에 넘길 계열 수를 정하는 쪽이 본다.
export { ALL_PAIRS_MAX, SLOT_COUNT } from "./chart/palette.ts";
