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
  snapshot_merge: "/_lophn/control/snapshot_merge",
  sync_cleanup: "/_lophn/control/sync_cleanup",
  sync_reapply: "/_lophn/control/sync_reapply",
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
// `hlc`는 sync 앱(`runs_on`에 phone이 있거나 `sync`가 table을 보냄)의 write·external이 changeset을 냈을 때 그 변경과 같이 commit된 clock이다.
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

// 다른 replica(폰이나 다른 기계)에서 온 변경들(보낸 쪽 hlc와 원래 changeset)을 칸 단위 last-write-wins로 한
// transaction에 적용한다. 1~1,000개, changeset 합 16 MiB까지(앱 process가 본다).
export const processSyncApplyRequestSchema = z.strictObject({
  changes: z
    .array(z.strictObject({ hlc: hlcSchema, changeset: base64Schema }))
    .min(1)
    .max(1000),
});
export type ProcessSyncApplyRequest = z.infer<
  typeof processSyncApplyRequestSchema
>;

// results는 요청의 변경마다 같은 순서로 하나다. applied: effective는 이 DB에서 실제로 바뀐 것(없으면 null). skipped:
// 제약(UNIQUE·CHECK 등)에 걸려 그 변경 하나를 하나도 적용하지 않았다(앱 problem으로 남는다). held: 정리된 흔적과
// 안전하게 합칠 수 없어 적용하지 않았다(버린 것이 아니다: core가 held 줄로 남긴다). not_sync: sync 앱이 아니다.
// 표나 칸이 이 DB와 맞지 않는 변경이 하나라도 있으면(다른 release) 아무것도 적용하지 않고 `conflict` 오류다.
export const processSyncApplyResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("applied"),
    results: z.array(
      z.discriminatedUnion("status", [
        z.strictObject({
          status: z.literal("applied"),
          effective: base64Schema.nullable(),
        }),
        z.strictObject({ status: z.literal("skipped"), message: z.string() }),
        z.strictObject({ status: z.literal("held") }),
      ]),
    ),
  }),
  z.strictObject({ status: z.literal("not_sync") }),
]);
export type ProcessSyncApplyResponse = z.infer<
  typeof processSyncApplyResponseSchema
>;

// 다른 기계의 snapshot(core가 data root 아래에 풀어 둔 SQLite file)을 덮지 않고 row·칸 clock으로 한 transaction에
// 합친다. `absent_deletes`가 있으면 clock이 `below` 이하이고 snapshot에 없으며 `keep`이 아닌 이 DB의 row를 지운다
// (horizon 밖에서 돌아올 때). keep의 pk는 `lophn_sync_row.pk` bytes의 base64다.
export const processSnapshotMergeRequestSchema = z.strictObject({
  path: z.string().min(1),
  // snapshot이 온 destination. 선언이 그리 보내는 표만 합친다.
  destination: z.string().min(1),
  absent_deletes: z
    .strictObject({
      below: hlcSchema,
      keep: z.array(
        z.strictObject({ table: z.string().min(1), pk: base64Schema }),
      ),
    })
    .optional(),
});
export type ProcessSnapshotMergeRequest = z.infer<
  typeof processSnapshotMergeRequestSchema
>;

// effective는 실제로 바뀐 것(없으면 null). 8 MiB를 넘으면 싣지 않고 `effective_dropped`로 알린다(합친 것은
// 그대로다). held는 정리된 흔적과 부딪을 수 있어 적용하지 않은 source row다: 그 row 전부의 INSERT changeset과
// 그 row의 가장 새 clock이고 core가 held 줄로 남긴다. 모양이 다른 표가 있으면 아무것도 쓰지 않고 `conflict` 오류다.
export const processSnapshotMergeResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("merged"),
      effective: base64Schema.nullable(),
      effective_dropped: z.literal("too_large").optional(),
      deleted: z.number().int().nonnegative(),
      held: z.array(
        z.strictObject({ hlc: hlcSchema, changeset: base64Schema }),
      ),
    }),
    z.strictObject({ status: z.literal("not_sync") }),
  ],
);
export type ProcessSnapshotMergeResponse = z.infer<
  typeof processSnapshotMergeResponseSchema
>;

// clock이 `before`보다 작은 흔적(tombstone)을 지운다. 경계는 core가 정한다. horizon은 지운 가장 큰 clock까지 올라간
// 지금 값이고 max_hlc는 이 DB가 내거나 본 가장 큰 clock이다.
export const processSyncCleanupRequestSchema = z.strictObject({
  before: hlcSchema,
});
export type ProcessSyncCleanupRequest = z.infer<
  typeof processSyncCleanupRequestSchema
>;

export const processSyncCleanupResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("cleaned"),
    dropped: z.number().int().nonnegative(),
    horizon: hlcSchema.nullable(),
    max_hlc: hlcSchema,
  }),
  z.strictObject({ status: z.literal("not_sync") }),
]);
export type ProcessSyncCleanupResponse = z.infer<
  typeof processSyncCleanupResponseSchema
>;

// held 줄의 changeset을 지금 clock의 이 기계 write로 다시 적용한다(사람의 다시 정함). 지금 data와 부딪으면
// 하나도 적용하지 않고 conflict다. applied의 hlc는 effective가 있을 때 그것과 같이 commit된 새 clock이다.
export const processSyncReapplyRequestSchema = z.strictObject({
  changeset: base64Schema,
  // 이 기계가 낸 held 변경이다: 이미 DB에 있어 다시 적용하지 않고, 건드린 row·칸의 지금 값을 새 clock으로 찍어 돌려준다.
  release: z.literal(true).optional(),
});
export type ProcessSyncReapplyRequest = z.infer<
  typeof processSyncReapplyRequestSchema
>;

export const processSyncReapplyResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("applied"),
    effective: base64Schema.nullable(),
    hlc: hlcSchema.nullable(),
  }),
  z.strictObject({ status: z.literal("conflict"), message: z.string() }),
  z.strictObject({ status: z.literal("not_sync") }),
]);
export type ProcessSyncReapplyResponse = z.infer<
  typeof processSyncReapplyResponseSchema
>;

// core가 고른 절대 path에 앱 DB의 사본을 쓴다. 이미 file이 있으면 실패한다. `phone`은 폰이 받을 DB 통째(`VACUUM INTO`),
// `folder`는 `destination`으로 갈 사본이라 선언이 그리 보내는 표만 담는다.
// `folder`만 `destination`이 있다(앱 process가 그 짝을 본다).
export const processSnapshotRequestSchema = z.strictObject({
  path: z.string().min(1),
  for: z.enum(["phone", "folder"]),
  destination: z.string().min(1).optional(),
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
