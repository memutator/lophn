import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { jsonValueSchema } from "../base/json-values.ts";
import { appIdSchema } from "../projects/values.ts";
import { releaseIdSchema } from "./apps.ts";

// supervisor가 앱 process에 보내는 제어 경로다. core API가 아니다.
export const CONTROL_PATHS = {
  probe: "/_lophn/control/probe",
  open: "/_lophn/control/open",
  close: "/_lophn/control/close",
  shutdown: "/_lophn/control/shutdown",
} as const;

// Unix socket HTTP의 가상 host. 필수 플랫폼 통로에만 쓴다.
export const SOCKET_HOST = "lophn.invalid";

// 시작 준비 확인 한도.
// 멈춤 유예.
// confirm 실행 marker 상한.
// 앱끼리 이어 부르는 깊이.
export const APP_CALL_DEPTH_LIMIT = 8;
// 내부 trace 이름 상한.
// socket 경로 UTF-8 상한.
export const SOCKET_PATH_MAX_BYTES = 104;

// test는 problems runner가 같은 진입점으로 띄우는 프로세스다.
// 화면 틀은 live·preview만 쓴다.
export const runtimeModeSchema = z.enum(["live", "preview", "test"]);
export type ChannelMode = z.infer<typeof runtimeModeSchema>;

export const screenSizeSchema = z.enum(["full", "panel", "card"]);

// tool key. 존재·grant 판정은 runtime이다. blueprint tool 이름은 toolNameSchema가 검사한다.
export const toolKeySchema = z.string().refine(
  (value) =>
    value.length > 0 && value.trim() === value && !/\p{Cc}/u.test(value) &&
    !value.includes("*"),
  {
    message:
      "tool key cannot be empty, padded, a wildcard, or contain controls",
  },
);

// tool 이름. MCP tool 이름 문자 집합이고 blueprint 선언 검사(blueprint/tools.ts)와 같은 규칙이다.
// 길이는 agent tool 이름(`domain__<domain>__<tool>`)에 들어가도록 64다.
export const toolNameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, {
  message: "tool name must be 1-64 characters of letters, digits, _ - .",
});

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
