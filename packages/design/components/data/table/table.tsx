import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/wording";
import { useObservedSize } from "../../_shared/resize.ts";
import {
  type Clipboard,
  componentMark,
  systemClipboard,
} from "../../_shared/shared.ts";
import {
  type CellFormat,
  IdCell,
  LinkCell,
  type LinkDataAttributes,
  NumberCell,
  TextCell,
  TimeCell,
} from "./cells.tsx";
import {
  type Density,
  rowPixels,
  virtualizes,
  virtualWindow,
} from "./model.ts";
import { domTableViewport, type TableViewport } from "./viewport.ts";
import styles from "./table.module.css";

interface ColumnBase {
  id: string;
  // 사람이 읽는 머리 이름. 호출자가 wording key나 데이터로 준다.
  header: string;
  // 단위는 머리에 한 번만 보이고 칸에는 숫자만 둔다.
  unit?: string;
}

export type TableColumn<Row> =
  | (ColumnBase & { kind: "text"; value: (row: Row) => string | undefined })
  | (ColumnBase & { kind: "number"; value: (row: Row) => number | undefined })
  | (ColumnBase & { kind: "time"; value: (row: Row) => Date | undefined })
  // 도메인 객체를 가리키는 글. 누르거나 Enter를 치면 행을 넘겨 onOpen을 부른다.
  | (ColumnBase & {
      kind: "link";
      value: (row: Row) => string | undefined;
      onOpen: (row: Row) => void;
      // 단추에 달 data 속성. 호출자가 DOM을 뒤져 달지 않아도 링크를 같은 표시로 찾게 한다.
      dataAttributes?: LinkDataAttributes;
    })
  // 내부 ID. diagnostics가 아니면 열 자체를 그리지 않는다.
  | (ColumnBase & { kind: "id"; value: (row: Row) => string })
  // 앱이 행 안에 그리는 것(단추 등). 값이 없어 정렬하지 않는다.
  | (ColumnBase & { kind: "custom"; render: (row: Row) => ReactNode });

export interface TableProps<Row> {
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  // 가상 scroll과 갱신에도 같은 행이 같은 DOM을 쓰도록 안정된 key를 준다.
  rowKey: (row: Row) => string;
  density?: Density;
  // 상대 시각의 기준. 호출자의 clock에서 받는다.
  now: Date;
  locale?: string;
  timeZone?: string;
  diagnostics?: boolean;
  clipboard?: Clipboard;
  viewport?: TableViewport;
}

function Spacer({
  rows,
  density,
  columns,
  viewport,
  edge,
}: {
  rows: number;
  density: Density;
  columns: number;
  viewport: TableViewport;
  edge: "before" | "after";
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  useLayoutEffect(() => {
    if (ref.current) viewport.reserve(ref.current, rows, density);
  }, [rows, density, viewport]);
  return (
    <tr
      ref={ref}
      className={styles.spacer}
      data-spacer={edge}
      data-rows={rows}
      aria-hidden="true"
    >
      <td colSpan={columns} />
    </tr>
  );
}

function cell<Row>(
  column: TableColumn<Row>,
  row: Row,
  format: CellFormat,
): ReactNode {
  switch (column.kind) {
    case "text":
      return <TextCell key={column.id} value={column.value(row)} />;
    case "number":
      return (
        <NumberCell key={column.id} value={column.value(row)} format={format} />
      );
    case "time":
      return (
        <TimeCell key={column.id} value={column.value(row)} format={format} />
      );
    case "link":
      return (
        <LinkCell
          key={column.id}
          value={column.value(row)}
          onOpen={() => column.onOpen(row)}
          dataAttributes={column.dataAttributes}
        />
      );
    case "id":
      return (
        <IdCell key={column.id} value={column.value(row)} format={format} />
      );
    case "custom":
      return (
        <td key={column.id} className={styles.custom} data-kind="custom">
          {column.render(row)}
        </td>
      );
  }
}

// 행 36/44px, sticky 머리, 1px subtle 구분선, 줄무늬 없음.
export function Table<Row>({
  columns,
  rows,
  rowKey,
  density = "compact",
  now,
  locale = "en",
  timeZone,
  diagnostics = false,
  clipboard = systemClipboard,
  viewport = domTableViewport,
}: TableProps<Row>) {
  const scroller = useRef<HTMLDivElement>(null);
  const size = useObservedSize(scroller);
  const [scrollTop, setScrollTop] = useState(0);
  const shown = useMemo(
    () => columns.filter((column) => diagnostics || column.kind !== "id"),
    [columns, diagnostics],
  );
  const format: CellFormat = { locale, now, timeZone, clipboard };
  const virtual = virtualizes(rows.length);
  const range = virtual
    ? virtualWindow(
        rows.length,
        rowPixels(density),
        scrollTop,
        size?.height ?? 0,
      )
    : { start: 0, end: rows.length, before: 0, after: 0 };
  const onScroll = virtual
    ? () => {
        if (scroller.current)
          setScrollTop(viewport.scrollTop(scroller.current));
      }
    : undefined;
  return (
    <div
      ref={scroller}
      className={styles.scroller}
      data-virtual={virtual || undefined}
      onScroll={onScroll}
      {...componentMark("Table")}
    >
      <table className={styles.table} data-density={density}>
        <thead>
          <tr>
            {shown.map((column) => (
              <th
                key={column.id}
                scope="col"
                data-kind={column.kind}
                className={
                  column.kind === "number" ? styles.numberHead : styles.head
                }
              >
                {column.unit === undefined
                  ? column.header
                  : t("common.heading.column-unit", {
                      header: column.header,
                      unit: column.unit,
                    })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {virtual && (
            <Spacer
              edge="before"
              rows={range.before}
              density={density}
              columns={shown.length}
              viewport={viewport}
            />
          )}
          {rows.slice(range.start, range.end).map((row) => {
            const key = rowKey(row);
            return (
              <tr key={key} data-key={key} className={styles.row}>
                {shown.map((column) => cell(column, row, format))}
              </tr>
            );
          })}
          {virtual && (
            <Spacer
              edge="after"
              rows={range.after}
              density={density}
              columns={shown.length}
              viewport={viewport}
            />
          )}
        </tbody>
      </table>
    </div>
  );
}
