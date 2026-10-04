import { useMemo } from "react";
import { ChartColumn } from "lucide-react";
import { t } from "@lophn/wording";
import { BarPlot } from "./bar-plot.tsx";
import {
  ChartFrame,
  type ChartLocaleProps,
  type ChartStateProps,
  type TableView,
} from "./chart-frame.tsx";
import { colorSeries } from "./palette.ts";
import type { Series } from "./types.ts";
import { seriesDrawable } from "./preflight.ts";
import { checkBars } from "./validate.ts";

export interface BarChartProps extends ChartStateProps, ChartLocaleProps {
  // 범주 이름. 겹치지 않는다.
  categories: readonly string[];
  series: readonly Series[];
  // 나올 수 있는 모든 엔티티의 안정된 순서. filter해도 같은 domain을 넘기면 색이 남는다.
  domain?: readonly string[];
  // 계열을 한 막대에 쌓는다. 양수는 위로, 음수는 아래로 쌓는다.
  stacked?: boolean;
  // 표 보기 첫 열의 머리.
  xLabel: string;
}

// 막대와 누적 막대. 막대는 최대 24px, data 끝 radius 4px, 사이 2px이다(shell/design-system#R41).
export function BarChart(
  {
    categories,
    series,
    domain,
    stacked = false,
    xLabel,
    locale = "en",
    timeZone,
    ...state
  }: BarChartProps,
) {
  const check = useMemo(
    () => checkBars({ categories, series, domain }),
    [categories, series, domain],
  );
  const colored = useMemo(
    () =>
      check.ok
        ? colorSeries(
          check.value.series,
          check.value.domain,
          t("common.label.other"),
        )
        : [],
    [check],
  );
  // 기타 합산이나 누적 합이 넘치면 그리지 않고 표도 만들지 않는다.
  const ready = check.ok && seriesDrawable(colored, stacked);
  const table: TableView | undefined = check.ok && ready
    ? {
      headers: [
        { header: xLabel, kind: "text" },
        ...colored.map((item) => ({
          header: item.label,
          kind: "number" as const,
        })),
      ],
      rows: check.value.categories.map((category, index) => ({
        key: String(index),
        cells: [
          category,
          ...colored.map((item) => item.values[index] ?? undefined),
        ],
      })),
    }
    : undefined;
  return (
    <ChartFrame
      {...state}
      locale={locale}
      timeZone={timeZone}
      problem={check.ok ? (ready ? undefined : "invalid") : check.problem}
      isEmpty={check.ok &&
        (categories.length === 0 || series.length === 0)}
      defaultIcon={ChartColumn}
      legend={colored}
      table={table}
    >
      {(width) =>
        check.ok && ready && (
          <BarPlot
            width={width}
            categories={check.value.categories}
            series={colored}
            stacked={stacked}
            format={{ locale, timeZone }}
            kind={stacked ? "stacked" : "bar"}
          />
        )}
    </ChartFrame>
  );
}
