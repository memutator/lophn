// contracts/apps/channel-values.ts와 같은 값. runtime graph는 Zod를 쓰지 않으므로
// 상수를 여기 두고 테스트가 contracts 값과 같음을 확인한다.
export const DIRECT_SOCKET_PATHS = {
  screen: "/screens",
  invoke: "/_lophn/commands/invoke",
  cancel: "/_lophn/commands/cancel",
  status: "/_lophn/commands/status",
  probe: "/_lophn/control/probe",
  open: "/_lophn/control/open",
  close: "/_lophn/control/close",
  shutdown: "/_lophn/control/shutdown",
} as const;

export const BROKER_PATHS = {
  ready: "/_lophn/broker/ready",
  invocationsSubmit: "/_lophn/broker/invocations/submit",
} as const;

export const SOCKET_HOST = "lophn.invalid";
export const READY_TIMEOUT_MS = 30_000;
export const SHUTDOWN_GRACE_MS = 10_000;
export const CONFIRM_MARKER_LIMIT = 4096;
export const TRACE_NAME_MAX_CHARS = 64;
export const SOCKET_PATH_MAX_BYTES = 104;
export const COMMAND_BODY_MAX_BYTES = 1_048_576;
export const READ_COVERAGE = ["complete", "partial", "uncollected"] as const;
export const READ_FRESHNESS = ["fresh", "stale", "unknown"] as const;
export const COMMAND_PROGRESS = [
  "running",
  "succeeded",
  "failed",
  "unknown",
] as const;
