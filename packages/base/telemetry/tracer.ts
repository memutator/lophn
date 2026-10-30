import type { Clock } from "../clock.ts";
import type { RandomSource } from "../random.ts";
import {
  newSpanId,
  newTraceId,
  type SpanContext,
  type TraceContextStore,
} from "./trace-context.ts";

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

// OTLP의 SpanKind 번호와 같다(otlp.ts가 그대로 싣는다).
export const SPAN_KIND = {
  internal: 1,
  server: 2,
  client: 3,
} as const;
export type SpanKind = keyof typeof SPAN_KIND;

export type FinishedSpan = {
  name: string;
  kind: SpanKind;
  context: SpanContext;
  parentSpanId?: string;
  startMs: number;
  endMs: number;
  attributes: Attributes;
  status: "unset" | "ok" | "error";
  statusMessage?: string;
  events: { name: string; atMs: number; attributes: Attributes }[];
};

export type Span = {
  readonly context: SpanContext;
  setAttribute(key: string, value: AttributeValue): void;
  setStatus(status: "ok" | "error", message?: string): void;
  // 예외는 type과 위치만 남긴다. message는 부르는 쪽이 이미 가린 것만 준다.
  recordException(attributes: Attributes): void;
  end(): void;
};

export type Tracer = {
  startSpan(
    name: string,
    options?: {
      kind?: SpanKind;
      attributes?: Attributes;
      // 없으면 지금 context의 span이 부모다. 받은 traceparent를 이을 때 준다.
      parent?: SpanContext;
    },
  ): Span;
  // fn을 새 span 안에서 돌린다. 던지면 error로 닫고 다시 던진다.
  inSpan<T>(
    name: string,
    options: { kind?: SpanKind; attributes?: Attributes },
    fn: (span: Span) => Promise<T>,
  ): Promise<T>;
  readonly context: TraceContextStore;
};

export function createTracer(options: {
  clock: Clock;
  random: RandomSource;
  context: TraceContextStore;
  onEnd(span: FinishedSpan): void;
}): Tracer {
  const tracer: Tracer = {
    context: options.context,
    startSpan(name, spanOptions = {}) {
      const parent = spanOptions.parent ?? options.context.active();
      const context: SpanContext = {
        traceId: parent?.traceId ?? newTraceId(options.random),
        spanId: newSpanId(options.random),
        sampled: parent?.sampled ?? true,
      };
      const finished: FinishedSpan = {
        name,
        kind: spanOptions.kind ?? "internal",
        context,
        ...(parent ? { parentSpanId: parent.spanId } : {}),
        startMs: options.clock.nowMs(),
        endMs: 0,
        attributes: { ...spanOptions.attributes },
        status: "unset",
        events: [],
      };
      let ended = false;
      return {
        context,
        setAttribute(key, value) {
          finished.attributes[key] = value;
        },
        setStatus(status, message) {
          finished.status = status;
          if (message === undefined) delete finished.statusMessage;
          else finished.statusMessage = message;
        },
        recordException(attributes) {
          finished.events.push({
            name: "exception",
            atMs: options.clock.nowMs(),
            attributes,
          });
        },
        end() {
          if (ended) return;
          ended = true;
          finished.endMs = options.clock.nowMs();
          if (context.sampled) options.onEnd(finished);
        },
      };
    },
    async inSpan(name, spanOptions, fn) {
      const span = tracer.startSpan(name, spanOptions);
      try {
        return await options.context.run(span.context, () => fn(span));
      } catch (thrown) {
        span.setStatus("error");
        span.recordException(describeThrown(thrown));
        throw thrown;
      } finally {
        span.end();
      }
    },
  };
  return tracer;
}

// 던져진 값의 종류와 처음 닿은 저장소 file 위치. 원문 message와 stack 전체는 남기지 않는다(secret이 섞일 수 있다).
export function describeThrown(thrown: unknown): {
  "exception.type": string;
  "code.location": string;
} {
  const type =
    thrown instanceof Error
      ? thrown.name
      : thrown === null
        ? "null"
        : typeof thrown;
  const stack = thrown instanceof Error ? (thrown.stack ?? "") : "";
  // 저장소 안 file(packages/, tools/, tests/)의 첫 frame. node 내부와 node_modules는 건너뛴다.
  const frame =
    /((?:packages|tools|tests)\/(?!.*node_modules)[^\s():]+:\d+:\d+)/.exec(
      stack,
    );
  return {
    "exception.type": type,
    "code.location": frame?.[1] ?? "unknown",
  };
}
