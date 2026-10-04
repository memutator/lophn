// 축·격자·tooltip 같은 차트 공통 SVG 조각. 글은 모두 React text로만 넣는다.
import { Fragment } from "react";
import {
  type Box,
  GEOMETRY,
  placeBottomLabels,
  valueLabelsFit,
} from "./geometry.ts";
import type { Slot } from "./types.ts";
import styles from "./chart.module.css";

export interface Tick {
  readonly at: number;
  readonly label: string;
}

// subtle 실선 격자와 왼쪽 값 label. 0 자리는 baseline으로 조금 진하다.
export function ValueGrid(
  { ticks, box, zero }: { ticks: readonly Tick[]; box: Box; zero?: number },
) {
  const labeled = valueLabelsFit(ticks.map((tick) => tick.label), box.left);
  return (
    <g data-axis="value">
      {ticks.map((tick) => (
        <Fragment key={tick.at}>
          <line
            className={tick.at === zero ? styles.baseline : styles.grid}
            x1={box.left}
            x2={box.right}
            y1={tick.at}
            y2={tick.at}
          />
          {labeled && (
            <text
              className={styles.tick}
              x={box.left - GEOMETRY.pad}
              y={tick.at}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tick.label}
            </text>
          )}
        </Fragment>
      ))}
    </g>
  );
}

// 세로 격자와 아래 값 label(산점의 x 축).
export function ColumnGrid(
  { ticks, box, width }: { ticks: readonly Tick[]; box: Box; width: number },
) {
  return (
    <g data-axis="column">
      {ticks.map((tick) => (
        <line
          key={tick.at}
          className={styles.grid}
          x1={tick.at}
          x2={tick.at}
          y1={box.top}
          y2={box.bottom}
        />
      ))}
      <BottomLabels ticks={ticks} box={box} width={width} />
    </g>
  );
}

// 아래 축 label. SVG 안에 다 들어가고 서로 겹치지 않는 것만 그린다.
export function BottomLabels(
  { ticks, box, width }: { ticks: readonly Tick[]; box: Box; width: number },
) {
  return (
    <g data-axis="category">
      {placeBottomLabels(ticks, width).map((tick) => (
        <text
          key={tick.at}
          className={styles.tick}
          x={tick.x}
          y={box.bottom + GEOMETRY.pad + GEOMETRY.caption / 2}
          textAnchor={tick.anchor}
          dominantBaseline="middle"
        >
          {tick.label}
        </text>
      ))}
    </g>
  );
}

export interface TooltipRow {
  readonly name: string;
  readonly value: string;
  readonly slot?: Slot;
}

// popover 표면의 tooltip. 위치는 SVG foreignObject의 x·y·width·height로만 정하고 inline style을 쓰지 않는다.
// 기준점이 plot 오른쪽 절반이면 왼쪽에, 아니면 오른쪽에 붙는다.
export function Tooltip(
  { anchor, box, width, title, rows }: {
    anchor: number;
    box: Box;
    width: number;
    title: string;
    rows: readonly TooltipRow[];
  },
) {
  const left = anchor > width / 2;
  // 상자는 언제나 SVG 폭 안이고 폭은 0 이상이다.
  const x = left ? 0 : Math.min(width, Math.max(0, anchor + GEOMETRY.pad));
  const span = left
    ? Math.min(width, Math.max(0, anchor - GEOMETRY.pad))
    : width - x;
  return (
    <foreignObject
      className={styles.tooltipBox}
      x={x}
      y={box.top}
      width={span}
      height={box.bottom - box.top}
    >
      <div className={styles.tooltipAnchor} data-side={left ? "left" : "right"}>
        <div className={styles.tooltip} data-tooltip="">
          <span className={styles.tooltipTitle}>{title}</span>
          {rows.map((row, index) => (
            <Fragment key={index}>
              {row.slot === undefined
                ? <span className={styles.tooltipBlank} />
                : (
                  <span
                    className={`${styles.series} ${styles.swatch}`}
                    data-slot={row.slot}
                  />
                )}
              <span className={styles.tooltipName}>{row.name}</span>
              <span className={styles.tooltipValue}>{row.value}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </foreignObject>
  );
}
