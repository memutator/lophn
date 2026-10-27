import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  Columns3,
} from "lucide-react";
import { t } from "@lophn/wording";
import { Button } from "../../primitives/button/button.tsx";
import { Checkbox } from "../../input/checkbox/checkbox.tsx";
import { Field } from "../../input/field/field.tsx";
import { IconButton } from "../../primitives/icon-button/icon-button.tsx";
import { Popover } from "../../overlay/popover/popover.tsx";
import { Select } from "../../input/select/select.tsx";
import type { TableColumn } from "../table/table.tsx";
import type { PageSlice, SortDirection, SortState } from "./model.ts";
import styles from "./data-table.module.css";

// 열 id는 caller 문자열이라 빈 값이나 원래 순서 값과 겹치지 않도록 접두사를 붙인다.
const ORIGINAL = "original";
const columnValue = (id: string) => `column:${id}`;

export function SortControl<Row>({
  columns,
  sort,
  onSort,
}: {
  columns: readonly TableColumn<Row>[];
  sort: SortState | null;
  onSort: (next: SortState | null) => void;
}) {
  const options = [
    { value: ORIGINAL, label: t("common.label.original-order") },
    ...columns.map((column) => ({
      value: columnValue(column.id),
      label: column.header,
    })),
  ];
  const direction: SortDirection = sort?.direction ?? "ascending";
  return (
    <div className={styles.sort}>
      <Field label={t("common.label.sort-by")}>
        <Select
          size="sm"
          options={options}
          value={sort ? columnValue(sort.columnId) : ORIGINAL}
          onValueChange={(value) => {
            const column = columns.find(
              (item) => columnValue(item.id) === value,
            );
            onSort(column ? { columnId: column.id, direction } : null);
          }}
        />
      </Field>
      <IconButton
        size="sm"
        variant="secondary"
        icon={
          direction === "ascending" ? ArrowUpNarrowWide : ArrowDownWideNarrow
        }
        label={
          direction === "ascending"
            ? t("common.button.sort-ascending")
            : t("common.button.sort-descending")
        }
        data-direction={direction}
        disabled={!sort}
        onClick={() =>
          sort &&
          onSort({
            columnId: sort.columnId,
            direction: direction === "ascending" ? "descending" : "ascending",
          })
        }
      />
    </div>
  );
}

// 열 목록은 Columns 버튼에 붙어 뜨는 popover다. 도구 줄 흐름을 밀지 않고,
// 바깥 click·Escape로 닫히며 focus는 연 버튼으로 돌아온다.
export function ColumnPicker<Row>({
  columns,
  shown,
  onToggle,
}: {
  columns: readonly TableColumn<Row>[];
  shown: ReadonlySet<string>;
  onToggle: (id: string, show: boolean) => void;
}) {
  return (
    <Popover
      trigger={
        <Button size="sm" icon={Columns3}>
          {t("common.button.columns")}
        </Button>
      }
    >
      <div className={styles.columnList}>
        {columns.map((column) => (
          <Checkbox
            key={column.id}
            label={column.header}
            checked={shown.has(column.id)}
            // 마지막 남은 열은 끌 수 없다.
            disabled={shown.has(column.id) && shown.size === 1}
            onCheckedChange={(checked) => onToggle(column.id, checked)}
          />
        ))}
      </div>
    </Popover>
  );
}

export function Pager({
  slice,
  total,
  onPage,
}: {
  slice: PageSlice;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className={styles.pager}>
      <span className={styles.range}>
        {t("common.label.row-range", {
          start: total === 0 ? 0 : slice.start + 1,
          end: slice.end,
          total,
        })}
      </span>
      <IconButton
        size="sm"
        icon={ChevronLeft}
        label={t("common.button.previous-page")}
        disabled={slice.page === 0}
        onClick={() => onPage(slice.page - 1)}
      />
      <IconButton
        size="sm"
        icon={ChevronRight}
        label={t("common.button.next-page")}
        disabled={slice.page >= slice.pages - 1}
        onClick={() => onPage(slice.page + 1)}
      />
    </div>
  );
}
