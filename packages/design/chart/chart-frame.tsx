import { type ReactNode, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, Rows3 } from "lucide-react";
import { t } from "@lophn/wording";
import { Button } from "@lophn/ui/primitives";
import {
  DataState,
  type DataStateProps,
  Table,
  type TableColumn,
} from "@lophn/ui/data";
import { EmptyState, Skeleton } from "@lophn/ui/feedback";
import { useObservedSize } from "@lophn/ui/shared";
import { ALL_PAIRS_MAX } from "./palette.ts";
import type { Slot } from "./types.ts";
import type { Problem } from "./validate.ts";
import styles from "./chart.module.css";

export interface ChartLocaleProps {
  // 숫자와 날짜 format의 locale. 기본은 en이다.
  locale?: string;
  // 날짜를 읽는 시간대. 없으면 실행 환경의 시간대다.
  timeZone?: string;
}

export type ChartStateProps = DataStateProps;

type TableCell = string | number | undefined;

interface TableRow {
  readonly key: string;
  readonly cells: readonly TableCell[];
}

export interface TableView {
  readonly headers: readonly { header: string; kind: "text" | "number" }[];
  readonly rows: readonly TableRow[];
}

interface LegendItem {
  readonly label: string;
  readonly slot: Slot;
}

// 표 보기에는 시간 칸이 없어 상대 시각 기준을 쓰지 않는다. Table이 요구하는 자리만 채운다.
const NO_RELATIVE_TIME = new Date(0);

function tableColumns(view: TableView): TableColumn<TableRow>[] {
  return view.headers.map(({ header, kind }, index) =>
    kind === "number"
      ? {
        id: `cell-${index}`,
        header,
        kind,
        value: (row) => row.cells[index] as number | undefined,
      }
      : {
        id: `cell-${index}`,
        header,
        kind,
        value: (row) => row.cells[index] as string | undefined,
      }
  );
}

function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul className={styles.legend}>
      {items.map((item, index) => (
        <li key={index} className={styles.legendItem}>
          <span
            className={`${styles.series} ${styles.swatch}`}
            data-slot={item.slot}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// 관측 칸은 내용과 함께 mount되고, 보기를 바꿔도 같은 element로 남아 폭 관측이 끊기지 않는다.
function Measured({ children }: { children: (width: number) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const size = useObservedSize(box);
  return (
    <div ref={box} className={styles.measure}>
      {size !== undefined && size.width > 0 && children(size.width)}
    </div>
  );
}

interface FrameProps extends ChartStateProps, ChartLocaleProps {
  problem?: Problem;
  isEmpty: boolean;
  defaultIcon: LucideIcon;
  legend: readonly LegendItem[];
  // 없으면 표 보기를 두지 않는다(색으로 구별하지 않는 도표).
  table?: TableView;
  children: (width: number) => ReactNode;
}

// 차트 공통 틀: 상태(loading·error·empty·그릴 수 없음) → 범례·표 보기 전환 → plot.
// 표 보기는 모든 차트에 있어 낮은 대비 slot(light aqua·yellow·magenta)의 값도 글로 읽는다.
export function ChartFrame(
  {
    problem,
    isEmpty,
    defaultIcon,
    legend,
    table,
    children,
    locale = "en",
    timeZone,
    ...state
  }: FrameProps,
) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const showTable = view === "table" && table !== undefined;
  const content = (width: number) => {
    if (problem === "invalid") {
      return (
        <EmptyState
          icon={CircleAlert}
          message={t("common.chart.unreadable")}
          action={{ label: t("common.button.retry"), onSelect: state.onRetry }}
        />
      );
    }
    if (showTable) {
      return (
        <div className={styles.tableView}>
          <Table
            columns={tableColumns(table)}
            rows={table.rows}
            rowKey={(row) => row.key}
            now={NO_RELATIVE_TIME}
            locale={locale}
            timeZone={timeZone}
          />
        </div>
      );
    }
    if (problem === "too-many-groups") {
      return (
        <EmptyState
          icon={Rows3}
          message={t("common.chart.too-many-groups", { max: ALL_PAIRS_MAX })}
          action={{
            label: t("common.button.show-table"),
            onSelect: () => setView("table"),
          }}
        />
      );
    }
    return children(width);
  };
  return (
    <DataState
      {...state}
      isEmpty={problem === undefined && isEmpty}
      defaultIcon={defaultIcon}
      placeholder={
        <div className={styles.placeholder}>
          <Skeleton lines={6} />
        </div>
      }
    >
      <div className={styles.frame}>
        {problem !== "invalid" && (legend.length >= 2 || table) && (
          <div className={styles.head}>
            {legend.length >= 2 && !showTable && <Legend items={legend} />}
            {table && (problem === undefined || showTable) && (
              <span className={styles.toggle}>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={showTable}
                  onClick={() =>
                    setView(showTable ? "chart" : "table")}
                >
                  {showTable
                    ? t("common.button.show-chart")
                    : t("common.button.show-table")}
                </Button>
              </span>
            )}
          </div>
        )}
        <div className={styles.body}>
          <Measured>{content}</Measured>
        </div>
      </div>
    </DataState>
  );
}
