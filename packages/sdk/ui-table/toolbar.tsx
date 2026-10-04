import { type KeyboardEvent, useId, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  Columns3,
} from "lucide-react";
import { t } from "@lophn/wording";
import {
  Button,
  Checkbox,
  Field,
  IconButton,
  Select,
  type TableColumn,
} from "@lophn/design/components";
import type { PageSlice, SortDirection, SortState } from "./model.ts";
import styles from "./ui-table.module.css";

// 열 id는 caller 문자열이라 빈 값이나 원래 순서 값과 겹치지 않도록 접두사를 붙인다.
const ORIGINAL = "original";
const columnValue = (id: string) => `column:${id}`;

export function SortControl<Row>(
  { columns, sort, onSort }: {
    columns: readonly TableColumn<Row>[];
    sort: SortState | null;
    onSort: (next: SortState | null) => void;
  },
) {
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
            const column = columns.find((item) =>
              columnValue(item.id) === value
            );
            onSort(column ? { columnId: column.id, direction } : null);
          }}
        />
      </Field>
      <IconButton
        size="sm"
        variant="secondary"
        icon={direction === "ascending"
          ? ArrowUpNarrowWide
          : ArrowDownWideNarrow}
        label={direction === "ascending"
          ? t("common.button.sort-ascending")
          : t("common.button.sort-descending")}
        data-direction={direction}
        disabled={!sort}
        onClick={() => sort && onSort({
          columnId: sort.columnId,
          direction: direction === "ascending" ? "descending" : "ascending",
        })}
      />
    </div>
  );
}

// 인라인으로 펼치는 열 목록. Escape로 닫으면 focus는 연 버튼으로 돌아간다.
export function ColumnPicker<Row>(
  { columns, shown, onToggle }: {
    columns: readonly TableColumn<Row>[];
    shown: ReadonlySet<string>;
    onToggle: (id: string, show: boolean) => void;
  },
) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className={styles.columns}>
      <Button
        ref={trigger}
        size="sm"
        icon={Columns3}
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        onClick={() => setOpen(!open)}
      >
        {t("common.button.columns")}
      </Button>
      {open && (
        <div id={panel} className={styles.columnList} onKeyDown={onKeyDown}>
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
      )}
    </div>
  );
}

export function Pager(
  { slice, total, onPage }: {
    slice: PageSlice;
    total: number;
    onPage: (page: number) => void;
  },
) {
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
