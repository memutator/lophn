// 차트 블록. 설치된 @lophn/ui-chart의 막대·선·산점 차트로 그린다(shell/workspace#R12). 블록의
// point 목록을 SDK의 선언형 입력(범주·시간 축과 계열 값)으로 옮길 뿐 식이나 HTML은 넘기지 않는다.
// SDK가 그릴 수 없는 조합(범주·숫자 축의 선, 시간 축의 산점, 한 계열의 같은 x)은 값을 바꾸거나 버리지
// 않고 같은 데이터를 표로 보인다. null은 결측이며 0으로 바꾸지 않는다.
import { BarChart, LineChart, ScatterChart } from "@lophn/ui-chart";
import { DataTable, type TableColumn } from "@lophn/ui-table";
import { formatNumber, t } from "@lophn/wording";

import { planChart } from "./chart-plan.ts";
import type { ChartContent } from "./registry.ts";
import { TABLE_PAGE_SIZE } from "./table-block.tsx";
import styles from "./visuals.module.css";

function withUnit(label: string, unit: string | null): string {
  return unit === null
    ? label
    : t("common.heading.column-unit", { header: label, unit });
}

interface TableRow {
  readonly index: number;
  readonly x: string;
  readonly values: readonly (readonly (number | null)[])[];
}

function cellText(values: readonly (number | null)[]): string | undefined {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return undefined;
  return present.map((value) => formatNumber(value)).join(", ");
}

export interface ChartBlockProps {
  content: ChartContent;
  onReadDescription: () => void;
  onRetry: () => void;
  now: Date;
}

export function ChartBlock(
  { content, onReadDescription, onRetry, now }: ChartBlockProps,
) {
  const plan = planChart(content);
  const xLabel = withUnit(content.x.label, content.x.unit);
  const yLabel = withUnit(content.y.label, content.y.unit);
  const state = {
    onRetry,
    empty: {
      message: t("conversation.empty.visual-no-data"),
      action: {
        label: t("conversation.button.visual-read-description"),
        onSelect: onReadDescription,
      },
    },
  };
  const axes = (
    <p className={styles.caption} data-visual-axes="">
      {t("conversation.label.visual-axes", { y: yLabel, x: xLabel })}
    </p>
  );
  if (plan.draw === "bar") {
    return (
      <div className={styles.stack} data-visual-chart="bar">
        {axes}
        <BarChart
          categories={plan.categories}
          series={plan.series}
          xLabel={xLabel}
          {...state}
        />
      </div>
    );
  }
  if (plan.draw === "line") {
    return (
      <div className={styles.stack} data-visual-chart="line">
        {axes}
        <LineChart
          x={plan.x}
          series={plan.series}
          xLabel={xLabel}
          timeZone="UTC"
          {...state}
        />
      </div>
    );
  }
  if (plan.draw === "scatter") {
    return (
      <div data-visual-chart="scatter">
        <ScatterChart
          groups={plan.groups}
          xLabel={xLabel}
          yLabel={yLabel}
          {...state}
        />
      </div>
    );
  }
  const columns: TableColumn<TableRow>[] = [
    { id: "x", header: xLabel, kind: "text", value: (row) => row.x },
    ...content.series.map((series, index): TableColumn<TableRow> => ({
      id: `series-${index}`,
      header: series.label,
      kind: "text",
      value: (row) => cellText(row.values[index] ?? []),
    })),
  ];
  return (
    <div className={styles.stack} data-visual-chart="table">
      <p className={styles.caption} data-visual-as-table="">
        {t("conversation.notice.visual-as-table")}
      </p>
      {axes}
      <DataTable
        columns={columns}
        rows={plan.rows.map((row, index) => ({ index, ...row }))}
        rowKey={(row) => String(row.index)}
        now={now}
        pageSize={TABLE_PAGE_SIZE}
        density="compact"
        {...state}
      />
    </div>
  );
}
