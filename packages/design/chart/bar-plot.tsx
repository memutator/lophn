// 막대 plot. 묶음·누적 막대와 분포가 같이 쓴다. 막대·점은 항목 tooltip이다.
// @ts-types="@types/d3-scale"
import { scaleBand } from "d3-scale";
import { axisNumber, type ChartLocale, exactNumber } from "./format.ts";
import { barHits, barItems } from "./bar-layout.ts";
import {
  axisGutter,
  barPath,
  GEOMETRY,
  largest,
  plotBox,
  stackTotals,
  textWidth,
  tickIndexes,
  valueScale,
} from "./geometry.ts";
import { BottomLabels, Tooltip, ValueGrid } from "./marks.tsx";
import type { ColoredSeries } from "./palette.ts";
import { useActive } from "./use-active.ts";
import styles from "./chart.module.css";

// 리뷰 probe와 테스트가 이 자리에서 geometry를 부른다.
export { type BarItem, barItems } from "./bar-layout.ts";

export function BarPlot(
  { width, categories, series, stacked, format, kind }: {
    width: number;
    // 범주 이름. 분포에서는 구간 이름이다.
    categories: readonly string[];
    series: readonly ColoredSeries[];
    stacked: boolean;
    format: ChartLocale;
    kind: "bar" | "stacked" | "distribution";
  },
) {
  const values = stacked
    ? categories.flatMap((_, index) =>
      stackTotals(series.map((item) => item.values[index] ?? null))
    )
    : series.flatMap((item) =>
      item.values.filter((value): value is number => value !== null)
    );
  const probe = valueScale(values, plotBox(width, 0, 0));
  const left = axisGutter(
    probe.ticks(4).map((tick) => axisNumber(tick, format)),
    width,
  );
  const box = plotBox(width, left, GEOMETRY.pad);
  const y = valueScale(values, box);
  const bands = scaleBand<number>()
    .domain(categories.map((_, index) => index))
    .range([box.left, box.right])
    .paddingInner(0.2)
    .paddingOuter(0.1);
  const band = (index: number) => ({
    start: bands(index) ?? box.left,
    width: bands.bandwidth(),
  });
  const items = barItems(categories.length, series, stacked, band, y);
  const hits = barHits(
    items,
    series.length,
    stacked,
    band,
    box.top,
    box.bottom,
  );
  const { active, setActive, plotProps } = useActive(items.length);
  const ticks = tickIndexes(
    categories.length,
    box.right - box.left,
    largest(categories.map(textWidth)),
  ).map((index) => ({
    at: band(index).start + band(index).width / 2,
    label: categories[index],
  }));
  const current = active === null ? undefined : items[active];
  return (
    <svg
      {...plotProps}
      className={styles.plot}
      width={width}
      height={GEOMETRY.height}
      data-chart={kind}
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
      {/* 넓은 hover 자리는 막대 아래에 둔다. 막대 자체는 언제나 자기 것이 hover를 받는다. */}
      {hits.map((hit, index) => (
        <rect
          key={`hit-${items[index].category}-${items[index].series}`}
          className={styles.hit}
          data-hit={index}
          x={hit.x}
          y={hit.y}
          width={hit.width}
          height={hit.height}
          onPointerEnter={() => setActive(index)}
        />
      ))}
      {items.map((item, index) => (
        <path
          key={`${item.category}-${item.series}`}
          className={`${styles.series} ${styles.bar}`}
          data-slot={item.slot}
          data-active={active === index || undefined}
          d={barPath(
            item.x,
            item.width,
            item.base,
            item.end,
            item.rounded ? GEOMETRY.barRadius : 0,
          )}
          onPointerEnter={() => setActive(index)}
        />
      ))}
      {current && (
        <Tooltip
          anchor={current.x + current.width / 2}
          box={box}
          width={width}
          title={categories[current.category]}
          rows={[{
            name: series[current.series].label,
            value: exactNumber(current.value, format),
            slot: current.slot,
          }]}
        />
      )}
    </svg>
  );
}
