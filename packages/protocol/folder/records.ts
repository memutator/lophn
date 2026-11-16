// 폴더의 기록 file: 기계 기록 `record.json`, 앱 기록 `app.json`, release 기록 `release.json`, source 목록 `source/<n>.json`.
// 모든 schema는 모르는 칸을 버리고 읽는다. 칸을 더해도 `format`은 그대로이고, 옛 판이 틀리게 읽게 되는 바꿈에만 오른다.
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { isSafeRelativePath } from "./layout.ts";
import { RECORD_MAX_BYTES } from "./limits.ts";

// 이 기계가 쓰는 꼴 판과, 이 기계의 file을 읽는 쪽이 가져야 할 판의 하한. 기계 기록의 `lophn.folder`에 그대로 싣는다.
// 변경 file 1행의 판(`lophn-folder 1`)과 기록의 `format`이 이 `version`이다.
export const FOLDER_FORMAT = { version: 1, min_version: 1 } as const;

export type FolderFormat = { version: number; min_version: number };

// 상대가 알린 하한이 내 판보다 크면 그 기계의 file을 읽지 않는다(`newer_format`). 아무것도 지우지 않는다.
export function canRead(peer: FolderFormat): boolean {
  return peer.min_version <= FOLDER_FORMAT.version;
}

export type FolderFileErrorCode = "invalid_file" | "newer_format" | "too_large";

export type FolderFileError = {
  code: FolderFileErrorCode;
  message: string;
};

export const fileError = (
  code: FolderFileErrorCode,
  message: string,
): Result<never, FolderFileError> => err({ code, message });

const machineId = idSchema("mch");
const appId = idSchema("app");
const commitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
// sync clock(HLC). 63 bit 정수라 십진 문자열이다.
export const hlcSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
export const destinationNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const formatSchema = z.number().int().min(1);
const versionRange = z.object({ version: positive, min_version: positive });

export const alwaysOnSchema = z.object({
  keep_running: z.boolean(),
  starts_at_login: z.boolean(),
  keep_awake: z.boolean(),
});

export const addressesSchema = z.object({
  lan: z.array(z.string()),
  port: z.number().int().min(1).max(65535).nullable(),
  relay: z.string().nullable(),
});

export const machineRecordSchema = z.object({
  format: formatSchema,
  machine: machineId,
  revision: positive,
  updated_at: atSchema,
  name: z.string().min(1).max(64),
  always_on: alwaysOnSchema.nullable(),
  addresses: addressesSchema,
  lophn: z.object({
    version: z.string().min(1),
    protocol: versionRange,
    folder: versionRange,
  }),
});
export type MachineRecord = z.infer<typeof machineRecordSchema>;

export const appRecordSchema = z.object({
  format: formatSchema,
  machine: machineId,
  app: appId,
  revision: positive,
  updated_at: atSchema,
  slug: z.string().min(1).max(63),
  name: z.string(),
  description: z.string(),
  sync_to: destinationNameSchema.nullable(),
  active_release: z
    .object({
      bundle_hash: sha256Schema,
      data_schema: count,
      code_commit: commitSchema,
      created_at: atSchema,
    })
    .nullable(),
  releases: z.array(sha256Schema),
  // head 0은 아직 쓴 file이 없다는 뜻이다.
  data: z.object({ head: count, snapshot: positive.nullable() }),
  source: z.object({ head: count }),
  // 이 기계가 그 앱에서 다른 기계마다 읽은 번호.
  read: z.record(machineId, z.object({ n: count, at: atSchema })),
  settled: hlcSchema.nullable(),
  horizon: hlcSchema.nullable(),
});
export type AppRecord = z.infer<typeof appRecordSchema>;

export const releaseRecordSchema = z.object({
  format: formatSchema,
  machine: machineId,
  app: appId,
  bundle_hash: sha256Schema,
  code_commit: commitSchema,
  declaration_hash: sha256Schema,
  data_schema: count,
  // 받는 기계의 activation이 apps protocol의 schema로 다시 본다. 안의 칸은 버리지 않고 그대로 넘긴다.
  data_changes: z.array(
    z.looseObject({
      from: count,
      to: count,
      script_hash: sha256Schema,
      description: z.string(),
    }),
  ),
  created_at: atSchema,
  files: z.array(
    z.object({
      path: z.string().refine(isSafeRelativePath, { message: "unsafe path" }),
      size: count,
      sha256: sha256Schema,
    }),
  ),
});
export type ReleaseRecord = z.infer<typeof releaseRecordSchema>;

// `source/<n>.json`: 같은 번호의 git bundle 뒤에 쓴다.
export const sourceMetaSchema = z.object({
  format: formatSchema,
  machine: machineId,
  app: appId,
  n: positive,
  heads: z.record(z.string().min(1), commitSchema),
  prerequisites: z.array(commitSchema),
  size: count,
  sha256: sha256Schema,
  created_at: atSchema,
});
export type SourceMeta = z.infer<typeof sourceMetaSchema>;

const formatOnly = z.object({ format: formatSchema });

/** 기록 file bytes를 읽는다. `format`을 먼저 보고 이 기계가 읽는 범위 밖이면 나머지를 보지 않는다. */
export function decodeRecord<S extends z.ZodType>(
  schema: S,
  bytes: Uint8Array,
): Result<z.output<S>, FolderFileError> {
  if (bytes.byteLength > RECORD_MAX_BYTES) {
    return fileError("too_large", "record file is too large");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fileError("invalid_file", "record file is not JSON");
  }
  const format = formatOnly.safeParse(json);
  if (!format.success) {
    return fileError("invalid_file", "record file has no format");
  }
  if (format.data.format > FOLDER_FORMAT.version) {
    return fileError(
      "newer_format",
      `record format ${format.data.format} is newer than this lophn reads`,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return fileError("invalid_file", "record file does not match its schema");
  }
  return ok(parsed.data);
}

/** 쓰기 전에 schema로 확인한다. 틀린 값은 부르는 쪽 실수라 던진다. */
export function encodeRecord<S extends z.ZodType>(
  schema: S,
  value: z.input<S>,
): Uint8Array {
  const checked = schema.parse(value);
  return new TextEncoder().encode(`${JSON.stringify(checked)}\n`);
}
