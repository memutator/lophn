// OTLP/HTTP JSON 본문을 만든다(opentelemetry-proto의 JSON 매핑). 보내는 것은 core가 node:http로 한다.
// 시각은 unix nano 문자열, trace·span id는 hex 문자열이다(OTLP JSON 매핑이 base64가 아니라 hex로 정했다).
import type { LogLevel } from "../log.ts";
import type { LogRecord } from "./log.ts";
import type { MetricSnapshot } from "./metrics.ts";
import {
  type AttributeValue,
  type Attributes,
  type FinishedSpan,
  SPAN_KIND,
} from "./tracer.ts";

type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };
type KeyValue = { key: string; value: AnyValue };

const SEVERITY: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};
const STATUS_CODE = { unset: 0, ok: 1, error: 2 } as const;
const SCOPE = { name: "lophn" };
// cumulative. meter가 시작부터 쌓은 값을 매번 전부 보낸다.
const AGGREGATION_CUMULATIVE = 2;

function anyValue(value: AttributeValue): AnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isInteger(value)
    ? { intValue: String(value) }
    : { doubleValue: value };
}

function keyValues(attributes: Attributes): KeyValue[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: anyValue(value),
  }));
}

function nanos(ms: number): string {
  return (BigInt(Math.round(ms * 1000)) * 1000n).toString();
}

export type Resource = { "service.name": string } & Attributes;

export function encodeSpans(
  resource: Resource,
  spans: readonly FinishedSpan[],
) {
  return {
    resourceSpans: [
      {
        resource: { attributes: keyValues(resource) },
        scopeSpans: [
          {
            scope: SCOPE,
            spans: spans.map((span) => ({
              traceId: span.context.traceId,
              spanId: span.context.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: SPAN_KIND[span.kind],
              startTimeUnixNano: nanos(span.startMs),
              endTimeUnixNano: nanos(span.endMs),
              attributes: keyValues(span.attributes),
              events: span.events.map((event) => ({
                name: event.name,
                timeUnixNano: nanos(event.atMs),
                attributes: keyValues(event.attributes),
              })),
              status: {
                code: STATUS_CODE[span.status],
                ...(span.statusMessage ? { message: span.statusMessage } : {}),
              },
            })),
          },
        ],
      },
    ],
  };
}

export function encodeMetrics(
  resource: Resource,
  metrics: readonly MetricSnapshot[],
  startMs: number,
  nowMs: number,
) {
  const start = nanos(startMs);
  const now = nanos(nowMs);
  return {
    resourceMetrics: [
      {
        resource: { attributes: keyValues(resource) },
        scopeMetrics: [
          {
            scope: SCOPE,
            metrics: metrics.map((metric) =>
              metric.kind === "counter"
                ? {
                    name: metric.name,
                    description: metric.description,
                    unit: metric.unit,
                    sum: {
                      aggregationTemporality: AGGREGATION_CUMULATIVE,
                      isMonotonic: true,
                      dataPoints: metric.points.map((point) => ({
                        attributes: keyValues(point.attributes),
                        startTimeUnixNano: start,
                        timeUnixNano: now,
                        asInt: String(point.value),
                      })),
                    },
                  }
                : {
                    name: metric.name,
                    description: metric.description,
                    unit: metric.unit,
                    histogram: {
                      aggregationTemporality: AGGREGATION_CUMULATIVE,
                      dataPoints: metric.points.map((point) => ({
                        attributes: keyValues(point.attributes),
                        startTimeUnixNano: start,
                        timeUnixNano: now,
                        count: String(point.count),
                        sum: point.sum,
                        min: point.min,
                        max: point.max,
                        bucketCounts: point.buckets.map(String),
                        explicitBounds: [...metric.bounds],
                      })),
                    },
                  },
            ),
          },
        ],
      },
    ],
  };
}

export function encodeLogs(resource: Resource, records: readonly LogRecord[]) {
  return {
    resourceLogs: [
      {
        resource: { attributes: keyValues(resource) },
        scopeLogs: [
          {
            scope: SCOPE,
            logRecords: records.map((record) => ({
              timeUnixNano: nanos(Date.parse(record.timestamp)),
              severityNumber: SEVERITY[record.level],
              severityText: record.level.toUpperCase(),
              body: {
                stringValue:
                  record.message === undefined
                    ? record.event
                    : `${record.event}: ${record.message}`,
              },
              attributes: [
                { key: "component", value: { stringValue: record.component } },
                { key: "event", value: { stringValue: record.event } },
                ...(record.fields === undefined
                  ? []
                  : [
                      {
                        key: "fields",
                        value: { stringValue: JSON.stringify(record.fields) },
                      },
                    ]),
              ],
              ...(record.trace_id
                ? { traceId: record.trace_id, spanId: record.span_id }
                : {}),
            })),
          },
        ],
      },
    ],
  };
}
