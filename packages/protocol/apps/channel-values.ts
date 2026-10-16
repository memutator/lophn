import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { jsonValueSchema } from "../base/json-values.ts";
import { appIdSchema } from "../projects/values.ts";
import { releaseIdSchema } from "./apps.ts";

// 로컬 socket 경로. core API가 아니다.
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

// Unix socket HTTP의 가상 host. 필수 플랫폼 통로에만 쓴다.
export const SOCKET_HOST = "lophn.invalid";

// 시작 준비 확인 한도.
// 멈춤 유예.
// confirm 실행 marker 상한.
// 앱끼리 이어 부르는 깊이.
export const APP_CALL_DEPTH_LIMIT = 8;
// automation 전체 동시 invocation 기본 한도.
// automation 호출 기본 timeout.
// 내부 trace 이름 상한.
// socket 경로 UTF-8 상한.
export const SOCKET_PATH_MAX_BYTES = 104;

// test는 problems runner가 같은 진입점으로 띄우는 프로세스다.
// 화면 틀은 live·preview만 쓴다.
export const runtimeModeSchema = z.enum(["live", "preview", "test"]);
export type ChannelMode = z.infer<typeof runtimeModeSchema>;

export const screenSizeSchema = z.enum(["full", "panel", "card"]);

// app-api key. blueprint app_api key와 같은 local 모양이다. 존재·grant 판정은 runtime이다.
export const appApiKeySchema = z.string().refine(
  (value) =>
    value.length > 0 && value.trim() === value && !/\p{Cc}/u.test(value) &&
    !value.includes("*"),
  {
    message:
      "app-api key cannot be empty, padded, a wildcard, or contain controls",
  },
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
export const turnIdSchema = idSchema("trn");
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
