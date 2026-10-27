import { useMemo } from "react";
import { ChartLine } from "lucide-react";
// @ts-types="@types/d3-scale"
import { scaleLinear } from "d3-scale";
// @ts-types="@types/d3-shape"
import { line } from "d3-shape";
import { t } from "@lophn/wording";
import {
  ChartFrame,
  type ChartLocaleProps,
  type ChartStateProps,
  type TableView,
} from "./chart-frame.tsx";
import {
  axisDate,
  axisNumber,
  type ChartLocale,
  exactNumber,
  tooltipDate,
} from "./format.ts";
import {
  axisGutter,
  GEOMETRY,
  labelsFit,
  largest,
  nearestIndex,
  plotBox,
  textWidth,
  tickIndexes,
  valueScale,
} from "./geometry.ts";
import { BottomLabels, Tooltip, ValueGrid } from "./marks.tsx";
import { type ColoredSeries, colorSeries, labelPolicy } from "./palette.ts";
import type { Series } from "./types.ts";
import { localX, useActive } from "./use-active.ts";
import { seriesDrawable } from "./preflight.ts";
import { checkTimeSeries } from "./validate.ts";
import styles from "./chart.module.css";

export interface LineChartProps extends ChartStateProps, ChartLocaleProps {
  // 공통 시간 축. 앞으로만 간다.
  x: readonly Date[];
  series: readonly Series[];
  // 나올 수 있는 모든 엔티티의 안정된 순서. filter해도 같은 domain을 넘기면 색이 남는다.
  domain?: readonly string[];
  // 표 보기 첫 열의 머리.
  xLabel: string;
}

function lastValue(values: readonly (number | null)[]) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== null) return { index, value };
  }
}

// 앞뒤가 비어 선이 생기지 않는 값은 점으로 보인다.
function isolated(values: readonly (number | null)[], index: number) {
  return (
    values[index] !== null &&
    (values[index - 1] ?? null) === null &&
    (values[index + 1] ?? null) === null
  );
}

function LinePlot({
  width,
  x,
  series,
  format,
}: {
  width: number;
  x: readonly Date[];
  series: readonly ColoredSeries[];
  format: ChartLocale;
}) {
  const { active, setActive, plotProps } = useActive(x.length);
  const values = series.flatMap((item) =>
    item.values.filter((value): value is number => value !== null),
  );
  const probe = valueScale(values, plotBox(width, 0, 0));
  const left = axisGutter(
    probe.ticks(4).map((tick) => axisNumber(tick, format)),
    width,
  );
  const policy = labelPolicy(series.length);
  const edge = GEOMETRY.point + GEOMETRY.ring;
  const reserve =
    largest(series.map((item) => textWidth(item.label))) + GEOMETRY.pad * 2;
  // 직접 라벨 칸은 plot이 그 칸보다 넓게 남을 때만 둔다. 아니면 범례·tooltip·표 보기로 읽는다.
  const roomForLabels =
    policy.directLabels && width - left - reserve >= reserve;
  const box = plotBox(width, left, roomForLabels ? reserve : edge);
  const y = valueScale(values, box);
  const time = scaleLinear()
    .domain([x[0].getTime(), x[x.length - 1].getTime()])
    .range([box.left, box.right]);
  const xs =
    x.length === 1
      ? [(box.left + box.right) / 2]
      : x.map((date) => time(date.getTime()));
  const path = line<number | null>()
    .defined((value) => value !== null)
    .x((_, index) => xs[index])
    .y((value) => y(value as number));
  const ends = series.map((item) => lastValue(item.values));
  const showLabels =
    roomForLabels &&
    labelsFit(ends.flatMap((end) => (end ? [y(end.value)] : []))) &&
    series.every((item, index) => {
      const end = ends[index];
      return (
        !end || xs[end.index] + GEOMETRY.pad + textWidth(item.label) <= width
      );
    });
  const ticks = tickIndexes(
    x.length,
    box.right - box.left,
    textWidth(axisDate(x[0], format)),
  ).map((index) => ({ at: xs[index], label: axisDate(x[index], format) }));
  return (
    <svg
      {...plotProps}
      className={styles.plot}
      width={width}
      height={GEOMETRY.height}
      data-chart="line"
      onPointerMove={(event) => setActive(nearestIndex(xs, localX(event)))}
    >
      <ValueGrid
        ticks={y.ticks(4).map((tick) => ({
          at: y(tick),
          label: axisNumber(tick, format),
        }))}
        box={box}
        zero={y(0)}
      />
      <BottomLabels ticks={ticks} box={box} width={width} />
      {series.map((item, index) => (
        <g
          key={index}
          className={styles.series}
          data-slot={item.slot}
          data-series={index}
        >
          <path className={styles.line} d={path(item.values) ?? ""} />
          {item.values.map(
            (value, at) =>
              isolated(item.values, at) && (
                <circle
                  key={at}
                  className={styles.point}
                  cx={xs[at]}
                  cy={y(value as number)}
                  r={GEOMETRY.point}
                />
              ),
          )}
        </g>
      ))}
      {showLabels &&
        series.map((item, index) => {
          const end = ends[index];
          return (
            end && (
              <text
                key={index}
                className={styles.directLabel}
                x={xs[end.index] + GEOMETRY.pad}
                y={y(end.value)}
                dominantBaseline="middle"
                data-direct-label=""
              >
                {item.label}
              </text>
            )
          );
        })}
      {active !== null && (
        <g data-active={active}>
          <line
            className={styles.crosshair}
            x1={xs[active]}
            x2={xs[active]}
            y1={box.top}
            y2={box.bottom}
          />
          {series.map((item, index) => {
            const value = item.values[active];
            return (
              value !== null && (
                <circle
                  key={index}
                  className={`${styles.series} ${styles.point}`}
                  data-slot={item.slot}
                  cx={xs[active]}
                  cy={y(value)}
                  r={GEOMETRY.point}
                />
              )
            );
          })}
          <Tooltip
            anchor={xs[active]}
            box={box}
            width={width}
            title={tooltipDate(x[active], format)}
            rows={series.flatMap((item) => {
              const value = item.values[active];
              return value === null
                ? []
                : [
                    {
                      name: item.label,
                      value: exactNumber(value, format),
                      slot: item.slot,
                    },
                  ];
            })}
          />
        </g>
      )}
    </svg>
  );
}

// 시계열 선 차트. 선은 2px이고 tooltip은 그 시각의 모든 계열을 읽는 십자선이다.
export function LineChart({
  x,
  series,
  domain,
  xLabel,
  locale = "en",
  timeZone,
  ...state
}: LineChartProps) {
  const check = useMemo(
    () => checkTimeSeries({ x, series, domain }),
    [x, series, domain],
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
  const format = { locale, timeZone };
  // 기타 합산이나 누적 합이 넘치면 그리지 않고 표도 만들지 않는다.
  const ready = check.ok && seriesDrawable(colored, false);
  const table: TableView | undefined =
    check.ok && ready
      ? {
          headers: [
            { header: xLabel, kind: "text" },
            ...colored.map((item) => ({
              header: item.label,
              kind: "number" as const,
            })),
          ],
          rows: check.value.x.map((date, index) => ({
            key: String(index),
            cells: [
              tooltipDate(date, format),
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
      isEmpty={check.ok && (x.length === 0 || series.length === 0)}
      defaultIcon={ChartLine}
      legend={colored}
      table={table}
    >
      {(width) =>
        check.ok &&
        ready && (
          <LinePlot
            width={width}
            x={check.value.x}
            series={colored}
            format={format}
          />
        )
      }
    </ChartFrame>
  );
}
