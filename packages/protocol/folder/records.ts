// 폴더의 기록 file: 기계 기록 `record.json`, 앱 기록 `app.json`, source 목록 `source/<n>.json`.
// 모든 schema는 모르는 칸을 버리고 읽는다. 칸을 더해도 `format`은 그대로이고, 옛 판이 틀리게 읽게 되는 바꿈에만 오른다.
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import {
  RECORD_MAX_BYTES,
  SHARED_PROJECT_KEY_MAX,
  SHARED_PROJECTS_MAX,
} from "./limits.ts";

// 이 기계가 쓰는 꼴 판(`version`)과 읽는 하한(`min_version`). 기계 기록의 `lophn.folder`에 그대로 싣는다.
// 변경 file 1행의 판(`lophn-folder 2`)과 기록의 `format`이 이 `version`이다. 판은 옛 판이 읽으면 틀리는 바꿈에만
// 올린다: 칸을 더하는 것은 올리지 않는다(읽는 쪽이 모르는 칸을 버린다). 칸 하나에 판을 올리면 모든 기계가 멈춘다.
// 판 2: release bundle 전송을 없애고 source git bundle + local release 준비로 옮기며 기계 사이 신분을 code_commit으로 바꿨다.
// 범위 판정은 core/folder/import/compat.ts.
export const FOLDER_FORMAT = { version: 2, min_version: 2 } as const;

export type FolderFormat = { version: number; min_version: number };

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
export const commitSchema = z.string().regex(/^[0-9a-f]{40}$/);
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

// 이 기계의 active git project 하나. 내 다른 컴퓨터가 같은 저장소(remote key)의 project를 자동으로 같은 id로 맞추는 데
// 쓴다(architecture `project-identity`). 이름, 경로, url은 싣지 않는다. separated는 사람이 [Separate project]로 나눈 것이다.
export const sharedProjectSchema = z.object({
  identity: idSchema("pri"),
  remote_key: z.string().min(1).max(SHARED_PROJECT_KEY_MAX),
  separated: z.boolean(),
});
export type SharedProject = z.infer<typeof sharedProjectSchema>;

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
    // 이 칸이 없는 기록은 꼴 판 1만 쓰고 읽는 기계다.
    folder: versionRange.default({ version: 1, min_version: 1 }),
  }),
  // 이 칸이 없는 기록(옛 lophn)은 맞출 project가 없는 것이다.
  projects: z.array(sharedProjectSchema).max(SHARED_PROJECTS_MAX).default([]),
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
      code_commit: commitSchema,
      data_schema: count,
      created_at: atSchema,
    })
    .nullable(),
  // head 0은 아직 쓴 file이 없다는 뜻이다.
  data: z.object({ head: count, snapshot: positive.nullable() }),
  source: z.object({ head: count }),
  // 이 기계가 그 앱에서 다른 기계마다 읽은 번호.
  read: z.record(machineId, z.object({ n: count, at: atSchema })),
  settled: hlcSchema.nullable(),
  horizon: hlcSchema.nullable(),
});
export type AppRecord = z.infer<typeof appRecordSchema>;

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

// `packages/<part>@<version>.json`: `@me/*` package의 한 version. bundle은 `package.publish`가 낸 source file 묶음 bytes
// (`bundle_hash`가 그 sha256)이고 guide는 안내 글 bytes다. 받는 기계가 같은 hash로 자기 catalog에 등록한다.
const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);
const meName = z.string().regex(/^@me\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
const exactVersion = z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/);
export const packageFileSchema = z.object({
  format: formatSchema,
  machine: machineId,
  name: meName,
  version: exactVersion,
  description: z
    .string()
    .regex(/\S/)
    .refine((value) => !/[\r\n]/.test(value), {
      message: "description must be a single line",
    }),
  owner_app: appId,
  permissions: z.array(z.string().min(1)),
  // 이 package가 의존하는 `@me/*`의 정확한 version. 받는 쪽이 먼저 들인다.
  requires: z.array(z.object({ name: meName, version: exactVersion })),
  bundle_hash: sha256Schema,
  guide_hash: sha256Schema,
  bundle: base64,
  guide: base64,
});
export type PackageFile = z.infer<typeof packageFileSchema>;

const formatOnly = z.object({ format: formatSchema });

/**
 * 기록 file bytes를 읽는다. `format`을 먼저 보고 이 기계가 읽는 범위 밖이면 나머지를 보지 않는다.
 */
export function decodeRecord<S extends z.ZodType>(
  schema: S,
  bytes: Uint8Array,
  maxBytes: number = RECORD_MAX_BYTES,
): Result<z.output<S>, FolderFileError> {
  if (bytes.byteLength > maxBytes) {
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
