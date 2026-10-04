// 정렬·페이지·열 선택·숫자 정렬·가상 scroll을 갖춘 표(apps/sdk#R16). 칸 모양은 @lophn/design의 Table이 그린다.
export { DataTable, type DataTableProps } from "./data-table.tsx";
export {
  DataState,
  type DataStateProps,
  type EmptySpec,
} from "./data-state.tsx";
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
} from "./model.ts";
export type { Density, TableColumn } from "@lophn/design/components";
