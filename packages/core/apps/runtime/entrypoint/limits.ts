import {
  CALL_RESPONSE_MAX_BYTES,
  CONTROL_MAX_BYTES,
} from "../../../../protocol/base/frame.ts";

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
  problemsObserve: "/_lophn/broker/problems/observe-exception",
  appsCall: "/_lophn/broker/apps/call",
} as const;

export const SOCKET_HOST = "lophn.invalid";
export const SHUTDOWN_GRACE_MS = 10_000;
export const SOCKET_PATH_MAX_BYTES = 104;
// 호출 본문과 결과는 control frame 하나에 담겨 오가므로 그 한도 아래로 정한다. 넘치면 호출이 결과 모름으로
// 닫힌다. 큰 값은 blob이나 file로 넘긴다.
// 본문은 `apps.call` frame 안의 request다. frame의 target과 worker_request envelope 몫 2 KiB를 뺀다.
export const CALL_BODY_MAX_BYTES = CONTROL_MAX_BYTES - 2 * 1024;
// 응답에서 결과 밖 칸(status, changeset, changeset_dropped)이 쓰는 몫 1 KiB를 뺀다.
export const RESULT_MAX_BYTES = CALL_RESPONSE_MAX_BYTES - 1024;
// 뒤집은 changeset 목록의 본문 상한이다.
export const APPLY_BODY_MAX_BYTES = 64 * 1_048_576;
