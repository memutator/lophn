import { useMemo } from "react";
import { Rows3 } from "lucide-react";
import { Skeleton } from "../skeleton/skeleton.tsx";
import { Table, type TableColumn, type TableProps } from "../table/table.tsx";
import { componentMark } from "../shared.ts";
import { useControllable } from "./controllable.ts";
import { DataState, type DataStateProps } from "./data-state.tsx";
import {
  clampPage,
  pageSlice,
  pickableColumns,
  sortable,
  sortRows,
  type SortState,
  toggleColumn,
  validPageSize,
  visibleColumns,
} from "./model.ts";
import { ColumnPicker, Pager, SortControl } from "./toolbar.tsx";
import styles from "./data-table.module.css";

export interface DataTableProps<Row>
  extends Omit<TableProps<Row>, "columns" | "rows">, DataStateProps {
  // 열의 value는 typed getter다. 문자열 식이나 script를 받지 않는다.
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  // 주면 caller가 정렬을 갖는다. null은 들어온 순서다.
  sort?: SortState | null;
  defaultSort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  // 없으면 페이지를 나누지 않고 1000행 넘게는 가상 scroll한다.
  pageSize?: number;
  // 0부터 센 페이지. 행 수가 줄면 마지막 페이지로 당겨 보인다.
  page?: number;
  onPageChange?: (page: number) => void;
  visibleColumns?: readonly string[];
  onVisibleColumnsChange?: (ids: readonly string[]) => void;
  // fill이면 caller 칸의 높이를 다 쓰고, 아니면 행 몇 줄 높이 안에서 표 안쪽이 scroll한다.
  layout?: "fill" | "inline";
}

export function DataTable<Row>(
  {
    columns,
    rows,
    sort: sortValue,
    defaultSort = null,
    onSortChange,
    pageSize,
    page: pageValue,
    onPageChange,
    visibleColumns: visibleValue,
    onVisibleColumnsChange,
    layout = "inline",
    loading,
    failed,
    onRetry,
    empty,
    timer,
    locale = "en",
    diagnostics = false,
    ...table
  }: DataTableProps<Row>,
) {
  const [sort, setSort] = useControllable(
    sortValue,
    defaultSort,
    onSortChange,
  );
  const [page, setPage] = useControllable(pageValue, 0, onPageChange);
  const [visible, setVisible] = useControllable<readonly string[] | undefined>(
    visibleValue,
    undefined,
    onVisibleColumnsChange &&
      ((ids) => ids !== undefined && onVisibleColumnsChange(ids)),
  );
  const pickable = pickableColumns(columns, diagnostics);
  const shown = visibleColumns(pickable, visible);
  const sorted = useMemo(
    () => sortRows(rows, columns, sort, locale),
    [rows, columns, sort, locale],
  );
  const size = validPageSize(pageSize);
  const slice = pageSlice(sorted.length, page, size);
  const pageRows = size === undefined
    ? sorted
    : sorted.slice(slice.start, slice.end);
  const onSort = (next: SortState | null) => {
    setSort(next);
    // 정렬이 바뀌면 처음부터 다시 읽는다.
    if (size !== undefined && slice.page !== 0) setPage(0);
  };
  return (
    <div
      className={styles.frame}
      data-layout={layout}
      {...componentMark("DataTable")}
    >
      <div className={styles.toolbar}>
        <SortControl
          columns={pickable.filter(sortable)}
          sort={sort}
          onSort={onSort}
        />
        <ColumnPicker
          columns={pickable}
          shown={new Set(shown.map((column) => column.id))}
          onToggle={(id, show) =>
            setVisible(toggleColumn(pickable, visible, id, show))}
        />
      </div>
      <div className={styles.body}>
        <DataState
          loading={loading}
          failed={failed}
          onRetry={onRetry}
          empty={empty}
          timer={timer}
          defaultIcon={Rows3}
          isEmpty={rows.length === 0}
          placeholder={<Skeleton lines={6} />}
        >
          <Table
            {...table}
            columns={shown}
            rows={pageRows}
            locale={locale}
            diagnostics={diagnostics}
          />
        </DataState>
      </div>
      {size !== undefined && rows.length > 0 && !loading &&
        failed === undefined && (
        <Pager
          slice={slice}
          total={sorted.length}
          onPage={(next) => setPage(clampPage(next, sorted.length, size))}
        />
      )}
    </div>
  );
}
