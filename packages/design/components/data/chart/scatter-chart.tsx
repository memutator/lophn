import { useMemo } from "react";
import { ChartScatter } from "lucide-react";
import { t } from "@lophn/i18n";
import {
  ChartFrame,
  type ChartLocaleProps,
  type ChartStateProps,
} from "./chart-frame.tsx";
import { axisNumber, type ChartLocale, exactNumber } from "./format.ts";
import {
  axisGutter,
  extentScale,
  GEOMETRY,
  plotBox,
  POINT_HIT,
} from "./geometry.ts";
import { ColumnGrid, Tooltip, ValueGrid } from "./marks.tsx";
import { slotOf } from "./palette.ts";
import type { ScatterGroup, Slot } from "./types.ts";
import { useActive } from "./use-active.ts";
import { pointsDrawable } from "./preflight.ts";
import { checkScatter, checkScatterShape } from "./validate.ts";
import styles from "./chart.module.css";

export interface ScatterChartProps extends ChartStateProps, ChartLocaleProps {
  groups: readonly ScatterGroup[];
  // 3 엔티티 이하의 안정된 순서. 넘으면 그리지 않고 표 보기로 모든 값을 보인다.
  domain?: readonly string[];
  xLabel: string;
  yLabel: string;
}

interface Placed {
  readonly group: number;
  readonly slot: Slot;
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
}

function ScatterPlot({
  width,
  groups,
  domain,
  xLabel,
  yLabel,
  format,
}: {
  width: number;
  groups: readonly ScatterGroup[];
  domain: readonly string[];
  xLabel: string;
  yLabel: string;
  format: ChartLocale;
}) {
  const points = groups.flatMap((group) => group.points);
  const probe = extentScale(
    points.map((point) => point.y),
    [1, 0],
  );
  const left = axisGutter(
    probe.ticks(4).map((tick) => axisNumber(tick, format)),
    width,
  );
  const box = plotBox(width, left, GEOMETRY.pad + GEOMETRY.point);
  const x = extentScale(
    points.map((point) => point.x),
    [box.left, box.right],
  );
  const y = extentScale(
    points.map((point) => point.y),
    [box.bottom, box.top],
  );
  const placed: Placed[] = groups.flatMap((group, index) =>
    group.points.map((point) => ({
      group: index,
      slot: slotOf(domain, group.key),
      x: point.x,
      y: point.y,
      cx: x(point.x),
      cy: y(point.y),
    })),
  );
  const { active, setActive, plotProps } = useActive(placed.length);
  const current = active === null ? undefined : placed[active];
  return (
    <svg
      {...plotProps}
      className={styles.plot}
      width={width}
      height={GEOMETRY.height}
      data-chart="scatter"
    >
      <ValueGrid
        ticks={y.ticks(4).map((tick) => ({
          at: y(tick),
          label: axisNumber(tick, format),
        }))}
        box={box}
      />
      <ColumnGrid
        ticks={x.ticks(4).map((tick) => ({
          at: x(tick),
          label: axisNumber(tick, format),
        }))}
        box={box}
        width={width}
      />
      {/* 넓은 hover 자리를 모두 점 아래에 둔다. 이웃 점의 자리가 점을 가리지 않는다. */}
      {placed.map((point, index) => (
        <circle
          key={`hit-${index}`}
          className={styles.hit}
          data-hit={index}
          cx={point.cx}
          cy={point.cy}
          r={POINT_HIT}
          onPointerEnter={() => setActive(index)}
        />
      ))}
      {placed.map((point, index) => (
        <circle
          key={index}
          className={`${styles.series} ${styles.point}`}
          data-slot={point.slot}
          data-active={active === index || undefined}
          cx={point.cx}
          cy={point.cy}
          r={GEOMETRY.point}
          onPointerEnter={() => setActive(index)}
        />
      ))}
      {current && (
        <Tooltip
          anchor={current.cx}
          box={box}
          width={width}
          title={groups[current.group].label}
          rows={[
            { name: xLabel, value: exactNumber(current.x, format) },
            { name: yLabel, value: exactNumber(current.y, format) },
          ]}
        />
      )}
    </svg>
  );
}

// 산점. 모든 쌍이 맞닿으므로 3계열까지만 그린다. 점은 radius 4px과 표면 ring이다.
export function ScatterChart({
  groups,
  domain,
  xLabel,
  yLabel,
  locale = "en",
  timeZone,
  ...state
}: ScatterChartProps) {
  const shape = useMemo(
    () => checkScatterShape({ groups, domain }),
    [groups, domain],
  );
  const check = useMemo(
    () => checkScatter({ groups, domain }),
    [groups, domain],
  );
  const format = { locale, timeZone };
  // 축이 넘치는 값 범위는 그리지 않는다. 표 보기는 받은 유한 값을 그대로 읽는다.
  const ready =
    check.ok &&
    pointsDrawable(check.value.groups.flatMap((group) => group.points));
  const legend = shape.ok
    ? shape.value.domain.flatMap((key) => {
        const group = shape.value.groups.find((item) => item.key === key);
        return group
          ? [{ label: group.label, slot: slotOf(shape.value.domain, key) }]
          : [];
      })
    : [];
  return (
    <ChartFrame
      {...state}
      locale={locale}
      timeZone={timeZone}
      problem={check.ok ? (ready ? undefined : "invalid") : check.problem}
      isEmpty={
        shape.ok &&
        shape.value.groups.every((group) => group.points.length === 0)
      }
      defaultIcon={ChartScatter}
      legend={legend}
      table={
        shape.ok &&
        (ready || (!check.ok && check.problem === "too-many-groups"))
          ? {
              headers: [
                { header: t("common.heading.group"), kind: "text" },
                { header: xLabel, kind: "number" },
                { header: yLabel, kind: "number" },
              ],
              rows: shape.value.groups.flatMap((group, index) =>
                group.points.map((point, at) => ({
                  key: `${index}-${at}`,
                  cells: [group.label, point.x, point.y],
                })),
              ),
            }
          : undefined
      }
    >
      {(width) =>
        check.ok &&
        ready && (
          <ScatterPlot
            width={width}
            groups={check.value.groups}
            domain={check.value.domain}
            xLabel={xLabel}
            yLabel={yLabel}
            format={format}
          />
        )
      }
    </ChartFrame>
  );
}
