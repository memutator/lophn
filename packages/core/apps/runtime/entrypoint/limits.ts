// protocol/apps의 channel-values·calls/process-wire와 같은 값. runtime graph는 Zod를 쓰지 않으므로
// 상수를 여기 둔다.
export const CONTROL_PATHS = {
  probe: "/_lophn/control/probe",
  open: "/_lophn/control/open",
  close: "/_lophn/control/close",
  shutdown: "/_lophn/control/shutdown",
} as const;

export const PROCESS_PATHS = {
  call: "/_lophn/control/call",
  apply: "/_lophn/control/apply",
} as const;

export const BROKER_PATHS = {
  ready: "/_lophn/broker/ready",
  problemsReport: "/_lophn/broker/problems/report",
  problemsObserve: "/_lophn/broker/problems/observe-exception",
  appsCall: "/_lophn/broker/apps/call",
  projectsList: "/_lophn/broker/projects/list",
} as const;

export const SOCKET_HOST = "lophn.invalid";
export const SHUTDOWN_GRACE_MS = 10_000;
export const SOCKET_PATH_MAX_BYTES = 104;
// 호출 본문과 결과의 상한이다. 큰 값은 blob이나 file로 넘긴다.
export const CALL_BODY_MAX_BYTES = 1_048_576;
export const RESULT_MAX_BYTES = 1_048_576;
// 뒤집은 changeset 목록의 본문 상한이다.
export const APPLY_BODY_MAX_BYTES = 64 * 1_048_576;
