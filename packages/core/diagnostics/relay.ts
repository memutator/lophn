import type { LogRecord, StructuredLogger } from "../../base/telemetry/mod.ts";

const LEVELS = new Set(["debug", "info", "warn", "error"]);
const NAME = /^[\w.:-]{1,80}$/;
// span 이름이 event가 된다("HTTP GET", "POST /resource/method"). 글이 들어올 수 있어 logger.relay가 redaction한다.
const EVENT = /^[^\p{Cc}]{1,120}$/u;
const TIME = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;

// child process의 stderr 한 줄을 core의 log로 싣는다. child가 낸 JSON log record는 구조(시각, service, trace·span id,
// level)를 그대로 두고 글과 fields만 core의 redaction을 거친다. record 모양이 아닌 줄(crash 글, 모르는 출력)은 글로만
// 싣는다. 어느 쪽이든 child의 원문은 redaction 없이 stderr나 log file에 나가지 않는다.
export function relayChildLine(
  logger: StructuredLogger,
  component: string,
  line: string,
): void {
  const record = parseRecord(line);
  if (record === undefined) {
    logger.info({ component, event: "child_stderr", message: line });
    return;
  }
  logger.relay(record);
}

function parseRecord(line: string): LogRecord | undefined {
  if (!line.startsWith("{")) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const { timestamp, level, service_name, component, event } = raw;
  if (
    typeof timestamp !== "string" ||
    !TIME.test(timestamp) ||
    typeof level !== "string" ||
    !LEVELS.has(level) ||
    typeof service_name !== "string" ||
    !NAME.test(service_name) ||
    typeof component !== "string" ||
    !NAME.test(component) ||
    typeof event !== "string" ||
    !EVENT.test(event)
  ) {
    return undefined;
  }
  const { trace_id, span_id, message, fields } = raw;
  const traced =
    typeof trace_id === "string" &&
    /^[0-9a-f]{32}$/.test(trace_id) &&
    typeof span_id === "string" &&
    /^[0-9a-f]{16}$/.test(span_id);
  return {
    timestamp,
    level: level as LogRecord["level"],
    service_name,
    ...(traced ? { trace_id, span_id } : {}),
    component,
    event,
    ...(typeof message === "string" ? { message } : {}),
    ...(typeof fields === "object" && fields !== null && !Array.isArray(fields)
      ? { fields: fields as Record<string, unknown> }
      : {}),
  };
}
