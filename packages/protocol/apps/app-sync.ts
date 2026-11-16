import { z } from "zod";
import { defineFile, defineMemory, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { appIdSchema } from "../projects/values.ts";
import { releaseIdSchema, toolNameSchema } from "./channel-values.ts";

// sync 앱(선언 `runs_on`에 phone)의 폰과 컴퓨터를 맞추는 route. 컴퓨터가 hub이고 ledger의 sync log가 앱마다
// 순서(`seq`)를 쥔다. 폰은 자기 cursor(받은 마지막 seq)를 쥐고, core는 기기마다 상태를 두지 않는다.
// 부르는 쪽은 짝지은 기기(principal `device:<id>`)다.

const MIB = 1024 * 1024;
export const APP_SYNC_PUSH_MAX_CHANGES = 256;
// push 하나의 changeset을 풀어 더한 상한과 change 하나의 상한(폰의 local 변경 상한과 같다).
export const APP_SYNC_PUSH_MAX_BYTES = 10 * MIB;
export const APP_SYNC_CHANGE_MAX_BYTES = 8 * MIB;
// pull 하나가 싣는 changeset bytes의 기본값과 상한. 한 변경이 이보다 커도 그 하나는 싣는다.
export const APP_SYNC_PULL_DEFAULT_BYTES = 8 * MIB;
export const APP_SYNC_PULL_MAX_BYTES = 10 * MIB;
export const APP_SYNC_FILE_MAX_BYTES = 8 * MIB;

const base64Schema = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);
// sync clock(HLC)은 63 bit 정수라 JSON에서 십진 문자열이다. core는 값을 비교하지 않는다.
const hlcSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const seqSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// 폰이 만든 ULID. 같은 기기의 같은 id는 같은 변경이다(다시 보내도 한 번만 적용된다).
const changeIdSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/);

export function base64Bytes(text: string): number {
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - padding;
}

const pushChangeSchema = z.strictObject({
  id: changeIdSchema,
  // 폰에서 부른 operation 이름. 컴퓨터의 invocation에 그대로 남는다.
  operation: toolNameSchema,
  started_at: atSchema,
  hlc: hlcSchema,
  changeset: base64Schema
    .min(1)
    .refine((value) => base64Bytes(value) <= APP_SYNC_CHANGE_MAX_BYTES, {
      message: "a change exceeds the size limit",
    }),
});

// applied: 컴퓨터에 적용했다. duplicate: 같은 기기의 같은 id가 이미 log에 있다(seq는 그때의 것). skipped: 적용이
// 제약(UNIQUE·CHECK 등)에 걸려 그 변경 하나를 건너뛰었다(앱 problem으로 남는다). 셋 다 폰은 outbox에서 지운다.
const pushResultSchema = z.strictObject({
  id: changeIdSchema,
  status: z.enum(["applied", "duplicate", "skipped"]),
  seq: seqSchema,
});

// 차례로 적용한다. 앱 process가 없으면 그 변경과 남은 것을 멈추고 `unavailable`이며 이미 된 것은 오류의
// `details.results`에 있다. release가 활성이 아니면 `conflict`이고 `details.active_release`가 지금 활성 release다.
// 출력 `seq`는 push가 끝난 때 그 앱 log의 마지막 seq다(cursor가 아니다: 그 사이의 다른 줄은 pull로 받는다).
export const appSyncPush = defineMemory({
  resource: "app_sync",
  method: "push",
  name: "app_sync.push",
  input: z.strictObject({
    app: appIdSchema,
    release: releaseIdSchema,
    changes: z
      .array(pushChangeSchema)
      .min(1)
      .max(APP_SYNC_PUSH_MAX_CHANGES)
      .refine(
        (changes) =>
          changes.reduce((sum, one) => sum + base64Bytes(one.changeset), 0) <=
          APP_SYNC_PUSH_MAX_BYTES,
        { message: "changes exceed the size limit" },
      ),
  }),
  output: z.strictObject({
    results: z.array(pushResultSchema),
    seq: seqSchema,
  }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "conflict",
    "unavailable",
  ],
});

const pulledChangeSchema = z.strictObject({
  seq: seqSchema,
  // machine: 다른 기계에서 폴더로 온 변경.
  origin: z.enum(["computer", "device", "rewind", "machine"]),
  hlc: hlcSchema,
  changeset: base64Schema,
});

// `after` 뒤의 변경을 seq 순서로. 부른 기기 자신이 보낸 줄은 빼되 `next`는 그 줄도 넘긴다.
// `snapshot_needed`: release가 활성이 아니거나 `after` 뒤에 '다시 snapshot' 줄이 있다(activation이 옛 줄을
// 지웠거나 보낼 수 없는 변경이 있었다). 그때 changes는 비고 폰은 `app_sync/snapshot`부터 다시 받는다.
export const appSyncPull = defineRead({
  resource: "app_sync",
  method: "pull",
  name: "app_sync.pull",
  input: z.strictObject({
    app: appIdSchema,
    release: releaseIdSchema,
    after: seqSchema,
    max_bytes: z.number().int().min(1).max(APP_SYNC_PULL_MAX_BYTES).optional(),
  }),
  output: z.strictObject({
    changes: z.array(pulledChangeSchema),
    next: seqSchema,
    more: z.boolean(),
    snapshot_needed: z.boolean(),
  }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "forbidden", "unavailable"],
});

// 컴퓨터 앱 DB의 사본. core가 write 줄을 쥔 채 뜨므로 사본은 정확히 `seq`까지의 변경을 담는다. `snapshot`은 불투명
// id이고 `expires_at`까지 `app_sync/snapshot_file`로 읽는다(부른 기기만).
export const appSyncSnapshot = defineMemory({
  resource: "app_sync",
  method: "snapshot",
  name: "app_sync.snapshot",
  input: z.strictObject({ app: appIdSchema }),
  output: z.strictObject({
    snapshot: z.string().min(1),
    release: releaseIdSchema,
    seq: seqSchema,
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    expires_at: atSchema,
  }),
  actors: ["user"],
  errors: ["not_found", "forbidden", "unavailable"],
});

// snapshot file의 한 구간. 끝까지 읽힌 file과 만료된 file은 지워져 `not_found`다.
export const appSyncSnapshotFile = defineFile({
  resource: "app_sync",
  method: "snapshot_file",
  name: "app_sync.snapshot_file",
  input: z.strictObject({
    snapshot: z.string().min(1),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    length: z.number().int().min(1).max(APP_SYNC_FILE_MAX_BYTES),
  }),
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: ["invalid_input", "not_found"],
});

export const APP_SYNC_ROUTES = [
  appSyncPush,
  appSyncPull,
  appSyncSnapshot,
  appSyncSnapshotFile,
] as const;
