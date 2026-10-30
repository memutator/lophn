import { useMemo } from "react";
import { ChartColumn } from "lucide-react";
import { t } from "@lophn/i18n";
import { BarPlot } from "./bar-plot.tsx";
import { binValues } from "./bins.ts";
import {
  ChartFrame,
  type ChartLocaleProps,
  type ChartStateProps,
} from "./chart-frame.tsx";
import { valueRange } from "./format.ts";
import type { ColoredSeries } from "./palette.ts";
import { binsDrawable } from "./preflight.ts";
import { checkDistribution } from "./validate.ts";

export interface DistributionChartProps
  extends ChartStateProps,
    ChartLocaleProps {
  // 잰 값 하나하나. 구간은 차트가 nice 경계로 나눈다.
  values: readonly number[];
  // 구간 수의 목표(1–50). 기본 10.
  bins?: number;
  // 잰 값의 이름. 표 보기의 구간 열 머리다.
  valueLabel: string;
}

// 값의 분포를 구간별 수의 막대로 보인다. 한 엔티티라 첫 slot(blue) 하나를 쓴다.
export function DistributionChart({
  values,
  bins,
  valueLabel,
  locale = "en",
  timeZone,
  ...state
}: DistributionChartProps) {
  const check = useMemo(
    () => checkDistribution({ values, bins }),
    [values, bins],
  );
  const format = { locale, timeZone };
  const counted = check.ok
    ? binValues(check.value.values, check.value.bins)
    : [];
  // 구간 경계가 넘치거나 값을 잃으면 그리지 않고 표도 만들지 않는다.
  const ready = check.ok && binsDrawable(check.value.values.length, counted);
  const ranges = counted.map((bin) => valueRange(bin.start, bin.end, format));
  const count = t("common.heading.count");
  const series: ColoredSeries[] = [
    {
      key: "count",
      label: count,
      values: counted.map((bin) => bin.count),
      slot: 0,
    },
  ];
  return (
    <ChartFrame
      {...state}
      locale={locale}
      timeZone={timeZone}
      problem={check.ok ? (ready ? undefined : "invalid") : check.problem}
      isEmpty={check.ok && values.length === 0}
      defaultIcon={ChartColumn}
      legend={[]}
      table={
        ready
          ? {
              headers: [
                { header: valueLabel, kind: "text" },
                {
                  header: count,
                  kind: "number",
                },
              ],
              rows: counted.map((bin, index) => ({
                key: String(index),
                cells: [ranges[index], bin.count],
              })),
            }
          : undefined
      }
    >
      {(width) =>
        ready && (
          <BarPlot
            width={width}
            categories={ranges}
            series={series}
            stacked={false}
            format={format}
            kind="distribution"
          />
        )
      }
    </ChartFrame>
  );
}
