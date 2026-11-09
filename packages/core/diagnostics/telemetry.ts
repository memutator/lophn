// process 하나의 telemetry. 구조화 log는 늘 stderr로 나가고(dev는 pretty, 아니면 JSON 한 줄) 기록기(log file)도 받는다.
// span은 끝날 때마다 debug log 한 줄이 된다. stderr는 LOPHN_LOG_LEVEL을 따르고, 기록기는 trace 설정(`setTrace`)이 켜면
// debug까지 받는다. OTLP는 LOPHN_TELEMETRY=otlp일 때만 span·metric·log를 OTLP/HTTP JSON으로 loopback 수집기에 보낸다.
// 바깥 host로는 보내지 않는다: core의 network는 loopback뿐이다.
import { AsyncLocalStorage } from "node:async_hooks";
import { request } from "node:http";
import type { Clock, LogLevel, RandomSource } from "../../base/mod.ts";
import {
  createLogger,
  createMeter,
  createRedMetrics,
  createTracer,
  encodeLogs,
  encodeMetrics,
  encodeSpans,
  type FinishedSpan,
  type LogFormat,
  type LogRecord,
  type Meter,
  type RedMetrics,
  type Resource,
  type SpanContext,
  type StructuredLogger,
  type TraceContextStore,
  type Tracer,
} from "../../base/telemetry/mod.ts";

export type TelemetryMode = "off" | "otlp";

export type TelemetryConfig = {
  mode: TelemetryMode;
  level: LogLevel;
  format: LogFormat;
  // OTLP/HTTP base URL(예: http://127.0.0.1:4318). mode가 otlp일 때만 있다.
  endpoint?: URL;
};

export type Telemetry = {
  logger: StructuredLogger;
  tracer: Tracer;
  meter: Meter;
  red: RedMetrics;
  config: TelemetryConfig;
  // 기록기가 debug log와 span 줄까지 받게 한다(설정 `diagnostics.trace`). 도중에 바꿀 수 있다.
  setTrace(on: boolean): void;
  // 알려진 secret 원문을 지우는 함수를 붙인다. secret store가 열린 뒤 core가 한 번 부른다. 그 전 log는
  // pattern 규칙(credential prefix·PEM)과 key 이름 규칙만으로 가린다.
  useRedactor(redact: (text: string) => string): void;
  // 남은 span·metric·log를 보낸다. 종료 때 한 번 부른다.
  shutdown(): Promise<void>;
};

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const MODES: readonly TelemetryMode[] = ["off", "otlp"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const EXPORT_INTERVAL_MS = 10_000;
const EXPORT_TIMEOUT_MS = 2_000;
const MAX_BUFFER = 2048;

// 잘못된 값은 기동을 막지 않고 기본값으로 둔다. 무엇을 버렸는지는 problems로 돌려 log 한 줄로 남긴다.
export function readTelemetryConfig(env: Record<string, string | undefined>): {
  config: TelemetryConfig;
  problems: string[];
} {
  const problems: string[] = [];
  const pick = <T extends string>(
    key: string,
    allowed: readonly T[],
    fallback: T,
  ): T => {
    const value = env[key];
    if (value === undefined || value === "") return fallback;
    if ((allowed as readonly string[]).includes(value)) return value as T;
    problems.push(`${key}=${value} is not one of ${allowed.join("|")}`);
    return fallback;
  };
  let mode = pick("LOPHN_TELEMETRY", MODES, "off");
  const level = pick("LOPHN_LOG_LEVEL", LEVELS, "info");
  const format = pick<LogFormat>(
    "LOPHN_LOG_FORMAT",
    ["json", "pretty"],
    "json",
  );
  let endpoint: URL | undefined;
  if (mode === "otlp") {
    const raw = env.OTEL_EXPORTER_OTLP_ENDPOINT;
    let parsed: URL | undefined;
    try {
      parsed = raw ? new URL(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    if (
      parsed === undefined ||
      parsed.protocol !== "http:" ||
      !LOOPBACK_HOSTS.has(parsed.hostname)
    ) {
      problems.push(
        "LOPHN_TELEMETRY=otlp needs OTEL_EXPORTER_OTLP_ENDPOINT=http://<loopback>:<port>; telemetry falls back to off",
      );
      mode = "off";
    } else {
      endpoint = parsed;
    }
  }
  return {
    config: { mode, level, format, ...(endpoint ? { endpoint } : {}) },
    problems,
  };
}

export function asyncContextStore(): TraceContextStore {
  const storage = new AsyncLocalStorage<SpanContext>();
  return {
    active: () => storage.getStore(),
    run: (context, fn) => storage.run(context, fn),
  };
}

// 수집기가 꺼져 있어도 core는 그대로 돈다. 실패는 한 번만 stderr에 알리고 다음 차례에 다시 보낸다.
function postJson(
  endpoint: URL,
  path: string,
  body: unknown,
): Promise<boolean> {
  const url = new URL(path, endpoint);
  const bytes = Buffer.from(JSON.stringify(body));
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const sent = request(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": bytes.length,
      },
      timeout: EXPORT_TIMEOUT_MS,
    },
    (response) => {
      response.resume();
      response.on("end", () => resolve((response.statusCode ?? 500) < 300));
    },
  );
  sent.on("timeout", () => sent.destroy());
  sent.on("error", () => resolve(false));
  sent.end(bytes);
  return promise;
}

export function createTelemetry(options: {
  service: string;
  clock: Clock;
  random: RandomSource;
  config: TelemetryConfig;
  // 한 줄(줄바꿈 없음)을 받는다. 보통 process.stderr.
  write(line: string): void;
  // stderr가 받는 최저 level. 없으면 config.level이다. agent runtime child는 debug로 둬 core가 거른다.
  writeLevel?: LogLevel;
  // log file 기록기. 없으면 stderr와 OTLP뿐이다.
  recorder?: {
    push(record: LogRecord): void;
    flush(): Promise<void>;
  };
}): Telemetry {
  const { config } = options;
  const context = asyncContextStore();
  const resource: Resource = {
    "service.name": options.service,
    "process.pid": process.pid,
  };
  const spans: FinishedSpan[] = [];
  const logs: LogRecord[] = [];
  const meter = createMeter(options.clock.nowMs());
  let warned = false;
  let trace = false;
  let redactKnown: ((text: string) => string) | undefined;

  const exportNow = async () => {
    if (config.mode !== "otlp" || config.endpoint === undefined) return;
    const endpoint = config.endpoint;
    const batch = spans.splice(0);
    const records = logs.splice(0);
    const results = await Promise.all([
      batch.length === 0
        ? true
        : postJson(endpoint, "v1/traces", encodeSpans(resource, batch)),
      records.length === 0
        ? true
        : postJson(endpoint, "v1/logs", encodeLogs(resource, records)),
      postJson(
        endpoint,
        "v1/metrics",
        encodeMetrics(
          resource,
          meter.snapshot(),
          meter.startMs,
          options.clock.nowMs(),
        ),
      ),
    ]);
    if (results.every(Boolean)) {
      warned = false;
      return;
    }
    if (!warned) {
      warned = true;
      options.write(
        JSON.stringify({
          timestamp: options.clock.now(),
          level: "warn",
          service_name: options.service,
          component: "telemetry",
          event: "otlp_export_failed",
          fields: { endpoint: endpoint.origin },
        }),
      );
    }
  };

  const logger = createLogger({
    service: options.service,
    clock: options.clock,
    level: options.writeLevel ?? config.level,
    // 기록기는 trace가 켜면 debug까지, 아니면 stderr와 같은 level부터 받는다.
    recordLevel: () => (trace ? "debug" : config.level),
    format: config.format,
    context,
    write: options.write,
    redactText: (text) => (redactKnown ? redactKnown(text) : text),
    onRecord: (record: LogRecord) => {
      options.recorder?.push(record);
      if (
        config.mode === "otlp" &&
        LEVELS.indexOf(record.level) >= LEVELS.indexOf(config.level) &&
        logs.length < MAX_BUFFER
      ) {
        logs.push(record);
      }
    },
    flush: exportNow,
  });

  const tracer = createTracer({
    clock: options.clock,
    random: options.random,
    context,
    onEnd(span) {
      // span 하나를 debug log 한 줄로 남긴다. 수집기 없이 지연을 보는 길이다. 아무도 debug를 받지 않으면 만들지 않는다.
      // span 자신의 trace·span id가 줄에 실리게 그 context 안에서 쓴다(끝난 뒤라 지금 context는 부모다).
      if (logger.enabled("debug")) {
        context.run(span.context, () =>
          logger.debug({
            component: "trace",
            event: span.name,
            fields: {
              duration_ms: Math.round((span.endMs - span.startMs) * 10) / 10,
              kind: span.kind,
              status: span.status,
              ...(span.parentSpanId === undefined
                ? {}
                : { parent_span_id: span.parentSpanId }),
              ...span.attributes,
            },
          }),
        );
      }
      if (config.mode === "otlp" && spans.length < MAX_BUFFER) {
        spans.push(span);
      }
    },
  });

  const timer =
    config.mode === "otlp"
      ? setInterval(() => void exportNow(), EXPORT_INTERVAL_MS)
      : undefined;
  timer?.unref();

  return {
    logger,
    tracer,
    meter,
    red: createRedMetrics(meter),
    config,
    setTrace(on) {
      trace = on;
    },
    useRedactor(redact) {
      redactKnown = redact;
    },
    async shutdown() {
      clearInterval(timer);
      await exportNow();
      await options.recorder?.flush();
    },
  };
}
