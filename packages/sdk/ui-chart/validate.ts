// 그리기 전에 입력 모양을 검사한다. 세션 시각 블록은 agent가 만든 data를 넘기므로
// 타입을 믿지 않고 실행 시점에 다시 본다. 통과하지 못하면 geometry를 만들지 않는다(NaN·Infinity가 SVG로 가지 않게).
import { ALL_PAIRS_MAX, foldsFinite } from "./palette.ts";
import type {
  GraphEdge,
  GraphNode,
  ScatterGroup,
  ScatterPoint,
  Series,
} from "./types.ts";

export type Problem = "invalid" | "too-many-groups";

export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: Problem };

const invalid = { ok: false, problem: "invalid" } as const;

export const MAX_BINS = 50;
export const DEFAULT_BINS = 10;

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isKey(value: unknown): value is string {
  return isText(value) && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Array.every와 some은 빈 자리(hole)를 건너뛴다. 자리마다 직접 보아 hole과 undefined를 거절한다.
function everyDense<T = unknown>(
  value: unknown,
  test: (item: unknown, index: number) => boolean,
): value is T[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !test(value[index], index)) {
      return false;
    }
  }
  return true;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

// 색을 정하는 domain. 주지 않으면 계열 순서다. 주면 모든 key를 담아야 엔티티 색이 흔들리지 않는다.
function checkDomain(
  keys: readonly string[],
  domain: unknown,
): readonly string[] | undefined {
  if (!unique(keys)) return;
  if (domain === undefined) return keys;
  if (!everyDense<string>(domain, isKey) || !unique(domain)) {
    return;
  }
  return keys.every((key) => domain.includes(key)) ? domain : undefined;
}

function checkSeriesList(
  series: unknown,
  length: number,
): series is readonly Series[] {
  return everyDense(
    series,
    (item) =>
      isRecord(item) && isKey(item.key) && isText(item.label) &&
      everyDense(
        item.values,
        (value) => value === null || isFiniteNumber(value),
      ) &&
      item.values.length === length,
  );
}

export interface TimeSeriesInput {
  readonly x: readonly Date[];
  readonly series: readonly Series[];
  readonly domain: readonly string[];
}

export function checkTimeSeries(
  input: { x: unknown; series: unknown; domain?: unknown },
): Checked<TimeSeriesInput> {
  const { x, series } = input;
  if (
    !everyDense<Date>(
      x,
      (value) => value instanceof Date && isFiniteNumber(value.getTime()),
    )
  ) return invalid;
  // 시간 축은 앞으로만 간다. 같은 시각이 둘이면 십자선이 한 값을 고를 수 없다.
  if (x.some((value, index) => index > 0 && value <= x[index - 1])) {
    return invalid;
  }
  if (!checkSeriesList(series, x.length)) return invalid;
  const domain = checkDomain(series.map((item) => item.key), input.domain);
  return domain && foldsFinite(series, domain)
    ? { ok: true, value: { x, series, domain } }
    : invalid;
}

export interface BarInput {
  readonly categories: readonly string[];
  readonly series: readonly Series[];
  readonly domain: readonly string[];
}

export function checkBars(
  input: { categories: unknown; series: unknown; domain?: unknown },
): Checked<BarInput> {
  const { categories, series } = input;
  if (
    !everyDense<string>(categories, isText) || !unique(categories)
  ) return invalid;
  if (!checkSeriesList(series, categories.length)) return invalid;
  const domain = checkDomain(series.map((item) => item.key), input.domain);
  return domain && foldsFinite(series, domain)
    ? { ok: true, value: { categories, series, domain } }
    : invalid;
}

export interface DistributionInput {
  readonly values: readonly number[];
  readonly bins: number;
}

export function checkDistribution(
  input: { values: unknown; bins?: unknown },
): Checked<DistributionInput> {
  const { values, bins = DEFAULT_BINS } = input;
  if (!everyDense<number>(values, isFiniteNumber)) return invalid;
  if (
    !Number.isSafeInteger(bins) || (bins as number) < 1 ||
    (bins as number) > MAX_BINS
  ) return invalid;
  return { ok: true, value: { values, bins: bins as number } };
}

export interface ScatterInput {
  readonly groups: readonly ScatterGroup[];
  readonly domain: readonly string[];
}

function isPoint(value: unknown): value is ScatterPoint {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

// 산점 입력의 모양만 본다. 계열 수 제한은 checkScatter가 따로 본다(표 보기는 모든 값을 그대로 쓴다).
export function checkScatterShape(
  input: { groups: unknown; domain?: unknown },
): Checked<ScatterInput> {
  const { groups } = input;
  if (
    !everyDense<ScatterGroup>(
      groups,
      (group) =>
        isRecord(group) && isKey(group.key) && isText(group.label) &&
        everyDense(group.points, isPoint),
    )
  ) return invalid;
  const domain = checkDomain(
    groups.map((group) => group.key),
    input.domain,
  );
  return domain ? { ok: true, value: { groups, domain } } : invalid;
}

// 산점은 모든 쌍이 맞닿으므로 domain 자체가 3 엔티티 이하여야 그린다. 넘으면 버리거나 합치지 않고 알린다.
export function checkScatter(
  input: { groups: unknown; domain?: unknown },
): Checked<ScatterInput> {
  const shape = checkScatterShape(input);
  if (shape.ok && shape.value.domain.length > ALL_PAIRS_MAX) {
    return { ok: false, problem: "too-many-groups" };
  }
  return shape;
}

export interface GraphInput {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export function checkGraph(
  input: { nodes: unknown; edges: unknown },
): Checked<GraphInput> {
  const { nodes, edges } = input;
  if (
    !everyDense<GraphNode>(
      nodes,
      (node) => isRecord(node) && isKey(node.id) && isText(node.label),
    )
  ) return invalid;
  const ids = nodes.map((node) => node.id);
  if (!unique(ids)) return invalid;
  const known = new Set(ids);
  if (
    !everyDense<GraphEdge>(
      edges,
      (edge) =>
        isRecord(edge) && isKey(edge.from) && isKey(edge.to) &&
        known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to &&
        (edge.label === undefined || isText(edge.label)),
    )
  ) return invalid;
  return { ok: true, value: { nodes, edges } };
}
