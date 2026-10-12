// 차트 블록의 point 목록을 design chart의 선언형 입력으로 옮기는 순수 규칙
// (shell/workspace#R12). 막대는 범주 축, 선은 시간 축, 산점은 숫자 축으로 그린다. chart가 그릴 수 없는
// 조합(범주·숫자 축의 선, 시간 축의 산점, 한 계열의 같은 x)은 값을 바꾸거나 버리지 않고 표로 보인다.
// null은 결측이며 0으로 바꾸지 않는다.
import { formatDate, formatNumber } from "@lophn/wording";

import type { ChartContent } from "./registry.ts";

/** design chart의 Series와 같은 모양. 이 파일은 CSS를 싣는 design module을 들이지 않는다. */
export interface Series {
  readonly key: string;
  readonly label: string;
  readonly values: readonly (number | null)[];
}

export type ChartPlan =
  | {
    readonly draw: "bar";
    readonly categories: readonly string[];
    readonly series: readonly Series[];
  }
  | {
    readonly draw: "line";
    readonly x: readonly Date[];
    readonly series: readonly Series[];
  }
  | {
    readonly draw: "scatter";
    readonly groups: readonly {
      readonly key: string;
      readonly label: string;
      readonly points: readonly { readonly x: number; readonly y: number }[];
    }[];
  }
  | {
    readonly draw: "table";
    /** x 값(입력에 처음 나온 순서)과 계열마다 그 x의 값들. */
    readonly rows: readonly {
      readonly x: string;
      readonly values: readonly (readonly (number | null)[])[];
    }[];
  };

function xKey(x: string | number): string {
  return typeof x === "number" ? `n:${x}` : `s:${x}`;
}

/** 입력에 처음 나온 순서의 x 값. */
function xsOf(content: ChartContent): (string | number)[] {
  const seen = new Map<string, string | number>();
  for (const series of content.series) {
    for (const point of series.points) {
      if (!seen.has(xKey(point.x))) seen.set(xKey(point.x), point.x);
    }
  }
  return [...seen.values()];
}

/** 계열마다 x 하나에 값 하나인지. 같은 x가 둘이면 축 하나에 값을 고를 수 없다. */
function singleValued(content: ChartContent): boolean {
  return content.series.every((series) =>
    new Set(series.points.map((point) => xKey(point.x))).size ===
      series.points.length
  );
}

function aligned(
  content: ChartContent,
  xs: readonly (string | number)[],
): Series[] {
  return content.series.map((series) => {
    const values = new Map(
      series.points.map((point) => [xKey(point.x), point.y]),
    );
    return {
      key: series.key,
      label: series.label,
      values: xs.map((x) => values.get(xKey(x)) ?? null),
    };
  });
}

function timeLabel(at: string, withTime: boolean): string {
  return formatDate(
    new Date(at),
    "en",
    withTime
      ? {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      }
      : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
}

/** x 값을 사람이 읽는 글로 옮긴다. 둘이 같은 글이 되면 더 자세히, 그래도 같으면 원래 값이다. */
function xLabels(
  content: ChartContent,
  xs: readonly (string | number)[],
): string[] {
  if (content.x.type === "category") return xs.map(String);
  if (content.x.type === "number") {
    const labels = xs.map((x) => formatNumber(x as number));
    return new Set(labels).size === labels.length ? labels : xs.map(String);
  }
  for (const withTime of [false, true]) {
    const labels = xs.map((x) => timeLabel(x as string, withTime));
    if (new Set(labels).size === labels.length) return labels;
  }
  return xs.map(String);
}

/** 블록을 SDK의 어느 차트로 그릴지 정한다. 순수 함수다. */
export function planChart(content: ChartContent): ChartPlan {
  const xs = xsOf(content);
  const table = (): ChartPlan => {
    const labels = xLabels(content, xs);
    return {
      draw: "table",
      rows: xs.map((x, index) => ({
        x: labels[index]!,
        values: content.series.map((series) =>
          series.points.filter((point) => xKey(point.x) === xKey(x)).map((
            point,
          ) => point.y)
        ),
      })),
    };
  };
  if (!singleValued(content)) return table();
  if (content.type === "bar") {
    return {
      draw: "bar",
      categories: xLabels(content, xs),
      series: aligned(content, xs),
    };
  }
  if (content.type === "line" && content.x.type === "time") {
    const sorted = [...xs].sort((a, b) =>
      Date.parse(a as string) - Date.parse(b as string)
    );
    return {
      draw: "line",
      x: sorted.map((x) => new Date(x as string)),
      series: aligned(content, sorted),
    };
  }
  if (content.type === "scatter" && content.x.type === "number") {
    // 결측(null)인 점은 자리가 없어 찍지 않는다. 0으로 바꾸지 않는다.
    return {
      draw: "scatter",
      groups: content.series.map((series) => ({
        key: series.key,
        label: series.label,
        points: series.points.flatMap((point) =>
          point.y === null ? [] : [{ x: point.x as number, y: point.y }]
        ),
      })),
    };
  }
  return table();
}
