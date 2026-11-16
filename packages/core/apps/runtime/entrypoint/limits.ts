import { CALL_RESULT_MAX_BYTES } from "../../../../protocol/apps/calls/limits.ts";
import {
  CALL_RESPONSE_MAX_BYTES,
  CONTROL_MAX_BYTES,
} from "../../../../protocol/base/frame.ts";
import {
  CHANGES_FILE_MAX_COUNT,
  CHANGES_PAYLOAD_MAX_BYTES,
  FOLDER_CHANGE_MAX_BYTES,
} from "../../../../protocol/folder/limits.ts";

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
  sync_apply: "/_lophn/control/sync_apply",
  snapshot: "/_lophn/control/snapshot",
  snapshot_merge: "/_lophn/control/snapshot_merge",
  sync_cleanup: "/_lophn/control/sync_cleanup",
  sync_reapply: "/_lophn/control/sync_reapply",
} as const;

export const BROKER_PATHS = {
  ready: "/_lophn/broker/ready",
  problemsObserve: "/_lophn/broker/problems/observe-exception",
  appsCall: "/_lophn/broker/apps/call",
} as const;

export const SOCKET_HOST = "lophn.invalid";
export const SHUTDOWN_GRACE_MS = 10_000;
// 호출 본문과 바깥 명령의 결과는 control frame 하나에 담겨 오가므로 그 한도 아래로 정한다. 넘치면 호출이
// 결과 모름으로 닫힌다. 큰 값은 blob이나 file로 넘긴다. 화면 operation의 응답만 frame을 넘어 bytes stream으로
// 가므로 아래 OPERATION 한도를 쓴다.
// 본문은 `apps.call` frame 안의 request다. frame의 target과 worker_request envelope 몫 2 KiB를 뺀다.
export const CALL_BODY_MAX_BYTES = CONTROL_MAX_BYTES - 2 * 1024;
// 응답에서 결과 밖 칸(status, changeset, changeset_dropped)이 쓰는 몫 1 KiB를 뺀다.
export const RESULT_MAX_BYTES = CALL_RESPONSE_MAX_BYTES - 1024;
// operation 응답 전체(결과·changeset·칸)의 상한과, 거기서 결과 밖 칸 몫 1 KiB를 뺀 결과 상한이다.
export const OPERATION_RESPONSE_MAX_BYTES = CALL_RESULT_MAX_BYTES;
export const OPERATION_RESULT_MAX_BYTES = CALL_RESULT_MAX_BYTES - 1024;
// 뒤집은 changeset 목록과 변경 묶음의 본문 상한이고, 묶음 적용·합치기 응답(effective)의 상한이다.
export const APPLY_BODY_MAX_BYTES = 64 * 1_048_576;
// 변경 묶음(`sync_apply`) 하나: 폴더의 변경 file 하나와 같은 한도다(file 하나가 transaction 하나).
export const SYNC_APPLY_MAX_CHANGES = CHANGES_FILE_MAX_COUNT;
export const SYNC_APPLY_MAX_BYTES = CHANGES_PAYLOAD_MAX_BYTES;
// snapshot 합치기의 effective는 invocation이 담는 changeset 한도까지만 싣는다. 넘으면 합친 것은 그대로 두고 뺀다.
export const MERGE_EFFECTIVE_MAX_BYTES = FOLDER_CHANGE_MAX_BYTES;
// 합치기가 held로 돌려주는 row changeset의 합. 넘으면 응답이 본문 한도를 넘어 held를 잃으니 합치기를 하지 않는다.
export const MERGE_HELD_MAX_BYTES = 32 * 1_048_576;
