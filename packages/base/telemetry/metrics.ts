import type { Attributes } from "./tracer.ts";

// 요청 지연 경계(ms). OTel HTTP semantic convention의 기본 경계를 ms로 옮긴 것이다.
export const DURATION_BOUNDS_MS = [
  5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
] as const;

export type CounterPoint = { attributes: Attributes; value: number };
export type HistogramPoint = {
  attributes: Attributes;
  count: number;
  sum: number;
  min: number;
  max: number;
  // bounds.length + 1칸. 마지막 칸은 마지막 경계보다 큰 값이다.
  buckets: number[];
};

export type MetricSnapshot =
  | {
      name: string;
      description: string;
      unit: string;
      kind: "counter";
      points: CounterPoint[];
    }
  | {
      name: string;
      description: string;
      unit: string;
      kind: "histogram";
      bounds: readonly number[];
      points: HistogramPoint[];
    };

export type Counter = { add(value: number, attributes: Attributes): void };
export type Histogram = { record(value: number, attributes: Attributes): void };

export type Meter = {
  counter(name: string, description: string, unit: string): Counter;
  histogram(
    name: string,
    description: string,
    unit: string,
    bounds: readonly number[],
  ): Histogram;
  // 시작부터 쌓인 값(cumulative). 내보내는 쪽이 매번 전부 읽는다.
  snapshot(): MetricSnapshot[];
  readonly startMs: number;
};

// attribute 조합마다 칸 하나다. route 이름처럼 개수가 정해진 값만 attribute로 쓴다(id를 넣으면 칸이 끝없이 는다).
const MAX_SERIES = 2000;

function seriesKey(attributes: Attributes): string {
  return JSON.stringify(
    Object.entries(attributes).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

export function createMeter(startMs: number): Meter {
  const counters = new Map<
    string,
    { description: string; unit: string; series: Map<string, CounterPoint> }
  >();
  const histograms = new Map<
    string,
    {
      description: string;
      unit: string;
      bounds: readonly number[];
      series: Map<string, HistogramPoint>;
    }
  >();
  return {
    startMs,
    counter(name, description, unit) {
      const entry = counters.get(name) ?? {
        description,
        unit,
        series: new Map(),
      };
      counters.set(name, entry);
      return {
        add(value, attributes) {
          const key = seriesKey(attributes);
          const point = entry.series.get(key);
          if (point) point.value += value;
          else if (entry.series.size < MAX_SERIES) {
            entry.series.set(key, { attributes: { ...attributes }, value });
          }
        },
      };
    },
    histogram(name, description, unit, bounds) {
      const entry = histograms.get(name) ?? {
        description,
        unit,
        bounds,
        series: new Map(),
      };
      histograms.set(name, entry);
      return {
        record(value, attributes) {
          const key = seriesKey(attributes);
          let point = entry.series.get(key);
          if (!point) {
            if (entry.series.size >= MAX_SERIES) return;
            point = {
              attributes: { ...attributes },
              count: 0,
              sum: 0,
              min: value,
              max: value,
              buckets: new Array(entry.bounds.length + 1).fill(0),
            };
            entry.series.set(key, point);
          }
          point.count += 1;
          point.sum += value;
          point.min = Math.min(point.min, value);
          point.max = Math.max(point.max, value);
          let index = entry.bounds.findIndex((bound) => value <= bound);
          if (index < 0) index = entry.bounds.length;
          point.buckets[index] += 1;
        },
      };
    },
    snapshot() {
      return [
        ...[...counters].map(
          ([name, entry]): MetricSnapshot => ({
            name,
            description: entry.description,
            unit: entry.unit,
            kind: "counter",
            points: [...entry.series.values()].map((point) => ({
              ...point,
            })),
          }),
        ),
        ...[...histograms].map(
          ([name, entry]): MetricSnapshot => ({
            name,
            description: entry.description,
            unit: entry.unit,
            kind: "histogram",
            bounds: entry.bounds,
            points: [...entry.series.values()].map((point) => ({
              ...point,
              buckets: [...point.buckets],
            })),
          }),
        ),
      ];
    },
  };
}

// RED: 요청 수, 오류 수, 지연. 오류는 5xx(lophn 쪽 실패)만 센다. 4xx는 부른 쪽의 잘못이라 따로 status로 본다.
export type RedMetrics = {
  observe(input: {
    route: string;
    method: string;
    status: number;
    durationMs: number;
  }): void;
};

export function createRedMetrics(meter: Meter): RedMetrics {
  const requests = meter.counter(
    "http.server.requests",
    "Requests handled by the core API",
    "{request}",
  );
  const errors = meter.counter(
    "http.server.errors",
    "Requests answered with a 5xx status",
    "{request}",
  );
  const duration = meter.histogram(
    "http.server.request.duration",
    "Time to produce the response head",
    "ms",
    DURATION_BOUNDS_MS,
  );
  return {
    observe({ route, method, status, durationMs }) {
      const attributes = {
        "http.route": route,
        "http.request.method": method,
        "http.response.status_code": status,
      };
      requests.add(1, attributes);
      if (status >= 500) errors.add(1, attributes);
      duration.record(durationMs, attributes);
    },
  };
}
