import { z } from "zod";
import { appIdSchema } from "../../projects/values.ts";
import { appStartInputSchema } from "../app-start.ts";
import {
  invocationIdSchema,
  jsonValueSchema,
  releaseIdSchema,
  runtimeModeSchema,
} from "../channel-values.ts";
import { appApiCallerSchema } from "./caller.ts";
import { appApiKeySchema } from "../channel-values.ts";
import { invocationEffectSchema } from "./invocation.ts";

// core와 앱 process 사이. 앱 process는 supervisor만 이 socket으로 부른다.
// probe·open·close·shutdown은 CONTROL_PATHS를 쓴다.
export const PROCESS_PATHS = {
  call: "/_lophn/control/call",
  apply: "/_lophn/control/apply",
} as const;

const base64Schema = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

export const processCallRequestSchema = z.strictObject({
  invocation: invocationIdSchema,
  api: appApiKeySchema,
  input: jsonValueSchema.optional(),
  context: z.strictObject({
    app: appIdSchema,
    release: releaseIdSchema.nullable(),
    mode: runtimeModeSchema,
    effect: invocationEffectSchema,
    caller: appApiCallerSchema.nullable(),
  }),
});
export type ProcessCallRequest = z.infer<typeof processCallRequestSchema>;

// 실패한 write도 DB가 일부 바뀌었을 수 있으므로 changeset을 싣는다. frame에 안 들어가면 빼고
// `changeset_dropped`로 알린다. changeset이 null이고 이 칸이 있으면 DB를 바꿨을 수 있다는 뜻이다.
export const processCallResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    result: jsonValueSchema,
    changeset: base64Schema.nullable(),
    changeset_dropped: z.literal("too_large").optional(),
  }),
  z.strictObject({
    status: z.literal("error"),
    error: z.strictObject({ code: z.string(), message: z.string() }),
    changeset: base64Schema.nullable(),
    changeset_dropped: z.literal("too_large").optional(),
  }),
]);
export type ProcessCallResponse = z.infer<typeof processCallResponseSchema>;

// core가 이미 최신부터 뒤집은 것이다. 적용 순서 그대로 담는다.
export const processApplyRequestSchema = z.strictObject({
  changesets: z.array(base64Schema),
});
export type ProcessApplyRequest = z.infer<typeof processApplyRequestSchema>;

// 충돌이면 하나도 적용하지 않은 것이다.
export const processApplyResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("applied"),
    count: z.number().int().nonnegative(),
  }),
  z.strictObject({ status: z.literal("conflict"), message: z.string() }),
]);
export type ProcessApplyResponse = z.infer<typeof processApplyResponseSchema>;

// 시작 입력에서 direct_socket을 빼고 control_socket을 더한 것이다.
const { direct_socket, ...kept } = appStartInputSchema.shape;
const appProcessStartInputSchema = z.strictObject({
  ...kept,
  control_socket: direct_socket,
}).refine(
  (value) => value.mode !== "live" || value.release !== null,
  { message: "live start needs a release" },
);
export type AppProcessStartInput = z.infer<typeof appProcessStartInputSchema>;

// 한 줄 JSON. 줄바꿈이 들어간 값은 시작 입력이 아니다.
