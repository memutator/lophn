type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEvent {
  component: string;
  event: string;
  message?: string;
  fields?: Record<string, unknown>;
}

interface LogInput extends LogEvent {
  level: LogLevel;
}

export interface Logger {
  log(input: LogInput): void;
  debug(input: LogEvent): void;
  info(input: LogEvent): void;
  warn(input: LogEvent): void;
  error(input: LogEvent): void;
  flush(): Promise<void>;
}
