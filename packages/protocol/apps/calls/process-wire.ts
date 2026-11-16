import { z } from "zod";
import { appIdSchema } from "../../projects/values.ts";
import { machineIdSchema } from "../../machine/mod.ts";
import { appStartInputSchema } from "../app-start.ts";
import {
  invocationIdSchema,
  jsonValueSchema,
  releaseIdSchema,
  runtimeModeSchema,
} from "../channel-values.ts";
import { appToolCallerSchema } from "./caller.ts";
import { toolKeySchema } from "../channel-values.ts";
import { callKindSchema } from "./call.ts";
import { invocationEffectSchema } from "./invocation.ts";

// core와 앱 process 사이. 앱 process는 supervisor만 이 socket으로 부른다.
// probe·open·close·shutdown은 CONTROL_PATHS를 쓴다.
export const PROCESS_PATHS = {
  call: "/_lophn/control/call",
  apply: "/_lophn/control/apply",
  sync_apply: "/_lophn/control/sync_apply",
  snapshot: "/_lophn/control/snapshot",
} as const;

const base64Schema = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);
// sync clock(HLC)은 63 bit 정수라 JS number로 안전하지 않아 JSON에서 십진 문자열이다.
const hlcSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);

export const processCallRequestSchema = z.strictObject({
  invocation: invocationIdSchema,
  kind: callKindSchema,
  name: toolKeySchema,
  input: jsonValueSchema.optional(),
  context: z.strictObject({
    app: appIdSchema,
    release: releaseIdSchema.nullable(),
    mode: runtimeModeSchema,
    effect: invocationEffectSchema,
    caller: appToolCallerSchema.nullable(),
  }),
});
export type ProcessCallRequest = z.infer<typeof processCallRequestSchema>;

// 실패한 write도 DB가 일부 바뀌었을 수 있으므로 changeset을 싣는다. 응답 한도(operation은
// `CALL_RESULT_MAX_BYTES`, command는 control frame 하나)에 안 들어가면 빼고 `changeset_dropped`로 알린다. changeset이 null이고 이 칸이 있으면 DB를 바꿨을 수 있다는 뜻이다.
// `hlc`는 sync 앱(`runs_on`에 phone)의 write·external이 changeset을 냈을 때 그 변경과 같이 commit된 clock이다.
export const processCallResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    result: jsonValueSchema,
    changeset: base64Schema.nullable(),
    changeset_dropped: z.literal("too_large").optional(),
    hlc: hlcSchema.optional(),
  }),
  z.strictObject({
    status: z.literal("error"),
    error: z.strictObject({ code: z.string(), message: z.string() }),
    changeset: base64Schema.nullable(),
    changeset_dropped: z.literal("too_large").optional(),
    hlc: hlcSchema.optional(),
  }),
]);
export type ProcessCallResponse = z.infer<typeof processCallResponseSchema>;

// core가 이미 최신부터 뒤집은 것이다. 적용 순서 그대로 담는다.
export const processApplyRequestSchema = z.strictObject({
  changesets: z.array(base64Schema),
});
export type ProcessApplyRequest = z.infer<typeof processApplyRequestSchema>;

// 충돌이면 하나도 적용하지 않은 것이다. sync 앱이면 `effective`(실제로 바뀐 것, 없으면 null)를 싣고, 바뀐 것이
// 있으면 그것과 같이 commit된 `hlc`도 싣는다.
export const processApplyResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("applied"),
    count: z.number().int().nonnegative(),
    effective: base64Schema.nullable().optional(),
    hlc: hlcSchema.optional(),
  }),
  z.strictObject({ status: z.literal("conflict"), message: z.string() }),
]);
export type ProcessApplyResponse = z.infer<typeof processApplyResponseSchema>;

// 폰에서 온 변경 하나(보낸 쪽 hlc와 원래 changeset)를 칸 단위 last-write-wins로 적용한다.
export const processSyncApplyRequestSchema = z.strictObject({
  change: z.strictObject({ hlc: hlcSchema, changeset: base64Schema }),
});
export type ProcessSyncApplyRequest = z.infer<
  typeof processSyncApplyRequestSchema
>;

// applied: effective는 이 DB에서 실제로 바뀐 것(없으면 null)이고 hlc는 받은 값이다. skipped: 적용이 제약(UNIQUE·CHECK
// 등)에 걸려 그 변경 하나를 하나도 적용하지 않고 건너뛰었다(앱 problem으로 남는다). not_sync: sync 앱이 아니다.
// 표나 칸이 이 DB와 맞지 않는 변경(다른 release)은 `conflict` 오류다.
export const processSyncApplyResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("applied"),
    effective: base64Schema.nullable(),
    hlc: hlcSchema,
  }),
  z.strictObject({
    status: z.literal("skipped"),
    hlc: hlcSchema,
    message: z.string(),
  }),
  z.strictObject({ status: z.literal("not_sync") }),
]);
export type ProcessSyncApplyResponse = z.infer<
  typeof processSyncApplyResponseSchema
>;

// core가 고른 절대 path에 앱 DB의 사본(`VACUUM INTO`)을 쓴다. 이미 file이 있으면 실패한다.
export const processSnapshotRequestSchema = z.strictObject({
  path: z.string().min(1),
});
export type ProcessSnapshotRequest = z.infer<
  typeof processSnapshotRequestSchema
>;

export const processSnapshotResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("written"),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.strictObject({ status: z.literal("not_sync") }),
]);
export type ProcessSnapshotResponse = z.infer<
  typeof processSnapshotResponseSchema
>;

// 시작 입력에서 direct_socket을 빼고 control_socket을 더한 것이다.
const { direct_socket, ...kept } = appStartInputSchema.shape;
const appProcessStartInputSchema = z
  .strictObject({
    ...kept,
    control_socket: direct_socket,
    // 이 기계의 id. sync 앱 DB의 node가 어느 기계에서 만든 것인지 가리는 데 쓴다.
    machine: machineIdSchema,
  })
  .refine((value) => value.mode !== "live" || value.release !== null, {
    message: "live start needs a release",
  });
export type AppProcessStartInput = z.infer<typeof appProcessStartInputSchema>;

// 한 줄 JSON. 줄바꿈이 들어간 값은 시작 입력이 아니다.
