export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  component: string;
  event: string;
  message?: string;
  fields?: Record<string, unknown>;
}

export interface LogInput extends LogEvent {
  level: LogLevel;
}

export interface LogRecord extends LogInput {
  at: string;
  fields: Record<string, unknown>;
  dropped?: number;
}

export interface LoggerOptions {
  sink: (record: LogRecord) => Promise<void> | void;
  now: () => string;
  level?: LogLevel;
  maxPendingBytes?: number;
  filter?: (fields: Record<string, unknown>) => Record<string, unknown>;
}

export interface Logger {
  log(input: LogInput): void;
  debug(input: LogEvent): void;
  info(input: LogEvent): void;
  warn(input: LogEvent): void;
  error(input: LogEvent): void;
  flush(): Promise<void>;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(options: LoggerOptions): Logger {
  const minimum = LEVEL_RANK[options.level ?? "info"];
  const maximum = options.maxPendingBytes ?? 1024 * 1024;
  if (!Number.isFinite(maximum) || maximum < 0) {
    throw new TypeError("maxPendingBytes must be finite and nonnegative");
  }
  const encoder = new TextEncoder();
  const queue: { json: string; bytes: number }[] = [];
  const waiters: (() => void)[] = [];
  let pendingBytes = 0;
  let dropped = 0;
  let draining = false;

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      pendingBytes -= entry.bytes;
      const record: LogRecord = JSON.parse(entry.json);
      const lost = dropped;
      dropped = 0;
      if (lost > 0) record.dropped = lost;
      try {
        await options.sink(record);
      } catch {
        // Failed output must not stop later records or erase loss diagnostics.
        dropped += lost + 1;
      }
    }
    draining = false;
    for (const resolve of waiters.splice(0)) resolve();
  }

  function log(input: LogInput): void {
    if (LEVEL_RANK[input.level] < minimum) return;
    let json: string;
    try {
      const fields = options.filter
        ? options.filter(input.fields ?? {})
        : input.fields ?? {};
      const record: LogRecord = {
        at: options.now(),
        level: input.level,
        component: input.component,
        event: input.event,
        ...(input.message === undefined ? {} : { message: input.message }),
        fields,
      };
      // Snapshot after redaction so queued records cannot regain unsafe fields.
      json = JSON.stringify(record);
    } catch {
      // Redaction or serialization failure must never fall back to raw input.
      dropped++;
      return;
    }
    const bytes = encoder.encode(json).byteLength;
    if (pendingBytes + bytes > maximum) {
      dropped++;
      return;
    }
    queue.push({ json, bytes });
    pendingBytes += bytes;
    if (!draining) {
      draining = true;
      queueMicrotask(() => void drain());
    }
  }

  return {
    log,
    debug: (input) => log({ ...input, level: "debug" }),
    info: (input) => log({ ...input, level: "info" }),
    warn: (input) => log({ ...input, level: "warn" }),
    error: (input) => log({ ...input, level: "error" }),
    flush: () =>
      draining
        ? new Promise<void>((resolve) => waiters.push(resolve))
        : Promise.resolve(),
  };
}
