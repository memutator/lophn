import { z } from "zod";
import {
  actorSchema,
  atSchema,
  idSchema,
  jsonValueSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { appIdSchema } from "../projects/values.ts";
import { releaseIdSchema } from "./apps.ts";

// architecture/apps 5.1의 로컬 socket 경로. core API가 아니다.
export const DIRECT_SOCKET_PATHS = {
  screen: "/screens",
  invoke: "/_lophn/commands/invoke",
  cancel: "/_lophn/commands/cancel",
  status: "/_lophn/commands/status",
  probe: "/_lophn/control/probe",
  open: "/_lophn/control/open",
  close: "/_lophn/control/close",
  shutdown: "/_lophn/control/shutdown",
  viewClosed: "/_lophn/control/view-closed",
} as const;

export const BROKER_SOCKET_PATHS = {
  ready: "/_lophn/broker/ready",
  invocationsSubmit: "/_lophn/broker/invocations/submit",
  controlWatch: "/_lophn/broker/control/watch",
  automationsTryAcquire: "/_lophn/broker/automations/try_acquire",
  automationsRelease: "/_lophn/broker/automations/release",
  netFetch: "/_lophn/broker/net/fetch",
  secretsUse: "/_lophn/broker/secrets/use",
  documentsSave: "/_lophn/broker/documents/save",
  problemsReport: "/_lophn/broker/problems/report",
  problemsObserve: "/_lophn/broker/problems/observe-exception",
  appsConnect: "/_lophn/broker/apps/connect",
  appsConfirmRequest: "/_lophn/broker/apps/confirm/request",
  appsConfirmPoll: "/_lophn/broker/apps/confirm/poll",
} as const;

// Unix socket HTTP의 가상 host. 필수 플랫폼 통로에만 쓴다(apps/runtime#R8).
export const SOCKET_HOST = "lophn.invalid";

// 시작 준비 확인 한도(apps/runtime#R2).
export const READY_TIMEOUT_MS = 30_000;
// 멈춤 유예(apps/runtime#R15).
export const SHUTDOWN_GRACE_MS = 10_000;
// confirm 실행 marker 상한(apps/invocations#R19).
export const CONFIRM_MARKER_LIMIT = 4096;
// 앱끼리 이어 부르는 깊이(apps/connections#R7).
export const APP_CALL_DEPTH_LIMIT = 8;
// automation 전체 동시 invocation 기본 한도(apps/automations#R6).
export const AUTOMATION_CONCURRENCY_LIMIT = 4;
// automation 호출 기본 timeout(apps/automations#R9).
export const AUTOMATION_TIMEOUT_MS = 600_000;
// 내부 trace 이름 상한(apps/sdk#R28).
export const TRACE_NAME_MAX_CHARS = 64;
// socket 경로 UTF-8 상한(architecture/apps 2.2).
export const SOCKET_PATH_MAX_BYTES = 104;

// test는 problems runner가 같은 진입점으로 띄우는 프로세스다(apps Q7).
// 화면 틀은 live·preview만 쓴다.
export const runtimeModeSchema = z.enum(["live", "preview", "test"]);
export type ChannelMode = z.infer<typeof runtimeModeSchema>;
export const viewModeSchema = z.enum(["live", "preview"]);
export type ViewMode = z.infer<typeof viewModeSchema>;

export const screenSizeSchema = z.enum(["full", "panel", "card"]);
export type ChannelScreenSize = z.infer<typeof screenSizeSchema>;

// blueprint command key와 같은 local 모양. 존재·grant 판정은 runtime이다.
export const commandKeySchema = z.string().min(1).refine(
  (value) =>
    value.trim().length > 0 && !/\p{Cc}/u.test(value) && !value.includes("*"),
  { message: "command key cannot be blank, a wildcard, or contain controls" },
);

export const screenKeySchema = z.string().min(1).refine(
  (value) => value.trim().length > 0 && !/\p{Cc}/u.test(value),
  { message: "screen key cannot be blank or contain controls" },
);

export const processNonceSchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value),
  { message: "process nonce contains a control character" },
);

export const opaqueSchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value),
  { message: "opaque value contains a control character" },
);

export const grantIdSchema = idSchema("grt");
export const invocationIdSchema = idSchema("inv");
export const approvalIdSchema = idSchema("apr");
export const runIdSchema = idSchema("run");
export const toolCallIdSchema = idSchema("tcl");

export const endpointSchema = z.string().min(1).refine(
  (value) => new TextEncoder().encode(value).byteLength < SOCKET_PATH_MAX_BYTES,
  { message: "socket path must be under 104 UTF-8 bytes" },
);

export {
  actorSchema,
  appIdSchema,
  atSchema,
  jsonValueSchema,
  releaseIdSchema,
  sha256Schema,
};
