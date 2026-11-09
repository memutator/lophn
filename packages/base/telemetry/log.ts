import type { Clock } from "../clock.ts";
import type { Logger, LogLevel } from "../log.ts";
import { REDACTION_REPLACEMENT } from "../redaction/model.ts";
import { matchCredential } from "../redaction/patterns.ts";
import type { TraceContextStore } from "./trace-context.ts";

export type LogFormat = "json" | "pretty";

// 한 줄이 된 log record. OTLP log 변환과 console 출력이 같은 값을 읽는다.
export type LogRecord = {
  timestamp: string;
  level: LogLevel;
  service_name: string;
  trace_id?: string;
  span_id?: string;
  component: string;
  event: string;
  message?: string;
  fields?: Record<string, unknown>;
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// 값이 아니라 이름만 보고 지우는 key. 값의 모양을 모르는 secret(사람이 정한 password 등)이 여기로 걸린다.
const SECRET_KEY =
  /pass(?:word|wd|phrase)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|bearer/i;
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
const MAX_STRING = 8 * 1024;

// pattern 규칙(고정 credential prefix·PEM)으로 지운다. 알려진 secret 원문은 부르는 쪽이 더한다.
export function redactCredentials(text: string): string {
  let out = "";
  let rest = text;
  for (;;) {
    const found = matchCredential(rest);
    if (!found) return out + rest;
    out += rest.slice(0, found.index) + REDACTION_REPLACEMENT;
    rest = rest.slice(found.index + found.length);
  }
}

// log field를 JSON에 실을 수 있는 값으로 바꾸며 secret을 지운다. 순환·깊이·크기를 넘는 것은 표시만 남긴다.
export function redactFields(
  value: unknown,
  redactText: (text: string) => string,
): unknown {
  const seen = new WeakSet<object>();
  const walk = (current: unknown, depth: number): unknown => {
    if (typeof current === "string") {
      const clipped =
        current.length > MAX_STRING
          ? `${current.slice(0, MAX_STRING)}…(${current.length} chars)`
          : current;
      return redactText(clipped);
    }
    if (
      current === null ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current === "bigint") return current.toString();
    if (current === undefined || typeof current === "function") {
      return undefined;
    }
    if (typeof current === "symbol") return current.toString();
    if (seen.has(current)) return "[circular]";
    if (depth >= MAX_DEPTH) return "[depth]";
    seen.add(current);
    if (current instanceof Error) {
      return {
        type: current.name,
        message: redactText(current.message),
      };
    }
    if (current instanceof Uint8Array) return `[bytes ${current.byteLength}]`;
    if (Array.isArray(current)) {
      const items = current
        .slice(0, MAX_ITEMS)
        .map((item) => walk(item, depth + 1));
      if (current.length > MAX_ITEMS) {
        items.push(`[+${current.length - MAX_ITEMS} items]`);
      }
      return items;
    }
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, item] of Object.entries(current)) {
      if (++count > MAX_ITEMS) {
        out["…"] = "[more keys]";
        break;
      }
      out[key] = SECRET_KEY.test(key)
        ? REDACTION_REPLACEMENT
        : walk(item, depth + 1);
    }
    return out;
  };
  return walk(value, 0);
}

export function formatLogRecord(record: LogRecord, format: LogFormat): string {
  if (format === "json") return JSON.stringify(record);
  const time = record.timestamp.slice(11, 23);
  const level = record.level.toUpperCase().padEnd(5);
  const parts = [`${time} ${level} ${record.component} ${record.event}`];
  if (record.message !== undefined) parts.push(record.message);
  for (const [key, value] of Object.entries(record.fields ?? {})) {
    parts.push(
      `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
    );
  }
  if (record.trace_id !== undefined) {
    parts.push(`trace=${record.trace_id.slice(0, 8)}…/${record.span_id}`);
  }
  return parts.join("  ");
}

export type StructuredLogger = Logger & {
  // write나 onRecord 어느 한쪽이라도 이 level을 받는지. debug 전용 일을 만들기 전에 묻는다.
  enabled(level: LogLevel): boolean;
  // 다른 process가 만든 record를 그대로 싣는다(시각·service·trace·span 유지). 글은 이쪽 redaction을 한 번 더 거친다.
  relay(record: LogRecord): void;
};

export function createLogger(options: {
  service: string;
  clock: Clock;
  // write(stderr)가 받는 최저 level.
  level: LogLevel;
  // onRecord가 받는 최저 level. 부를 때마다 읽는다(trace 설정처럼 도중에 바뀐다). 없으면 level이다.
  recordLevel?: () => LogLevel;
  format: LogFormat;
  context: TraceContextStore;
  // 이미 직렬화한 한 줄(끝 줄바꿈 없음)을 받는다. stderr 쓰기는 core가 한다.
  write(line: string): void;
  // pattern 규칙에 더해 알려진 secret을 지우는 함수. 없으면 pattern 규칙만이다.
  redactText?: (text: string) => string;
  // redaction을 마친 같은 record를 받는다(OTLP 전송, log file).
  onRecord?: (record: LogRecord) => void;
  flush?: () => Promise<void>;
}): StructuredLogger {
  const writeFloor = LEVEL_RANK[options.level];
  const recordFloor = () =>
    options.onRecord === undefined
      ? Number.POSITIVE_INFINITY
      : LEVEL_RANK[options.recordLevel?.() ?? options.level];
  const redactText = (text: string) =>
    redactCredentials(options.redactText ? options.redactText(text) : text);
  const emit = (record: LogRecord) => {
    const rank = LEVEL_RANK[record.level];
    if (rank >= writeFloor) {
      options.write(formatLogRecord(record, options.format));
    }
    if (rank >= recordFloor()) options.onRecord?.(record);
  };
  const logger: StructuredLogger = {
    enabled: (level) =>
      LEVEL_RANK[level] >= Math.min(writeFloor, recordFloor()),
    log(input) {
      if (LEVEL_RANK[input.level] < Math.min(writeFloor, recordFloor())) return;
      const span = options.context.active();
      emit({
        timestamp: options.clock.now(),
        level: input.level,
        service_name: options.service,
        ...(span ? { trace_id: span.traceId, span_id: span.spanId } : {}),
        component: input.component,
        event: input.event,
        ...(input.message === undefined
          ? {}
          : { message: redactText(input.message) }),
        ...(input.fields === undefined
          ? {}
          : {
              fields: redactFields(input.fields, redactText) as Record<
                string,
                unknown
              >,
            }),
      });
    },
    relay(record) {
      if (LEVEL_RANK[record.level] < Math.min(writeFloor, recordFloor())) {
        return;
      }
      emit({
        ...record,
        component: redactText(record.component),
        event: redactText(record.event),
        ...(record.message === undefined
          ? {}
          : { message: redactText(record.message) }),
        ...(record.fields === undefined
          ? {}
          : {
              fields: redactFields(record.fields, redactText) as Record<
                string,
                unknown
              >,
            }),
      });
    },
    debug: (event) => logger.log({ ...event, level: "debug" }),
    info: (event) => logger.log({ ...event, level: "info" }),
    warn: (event) => logger.log({ ...event, level: "warn" }),
    error: (event) => logger.log({ ...event, level: "error" }),
    flush: () => options.flush?.() ?? Promise.resolve(),
  };
  return logger;
}
