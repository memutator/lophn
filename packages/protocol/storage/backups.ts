import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { ACTOR_KINDS, type ActorKind, defineRead } from "../base/route.ts";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";

// backup은 coding agent가 읽지 못한다.
const BACKUP_READERS: readonly ActorKind[] = ACTOR_KINDS.filter((kind) =>
  kind !== "coding_agent"
);

// architecture/platform 7.5. domain model의 BackupManifest 필드와 같다.
export const BACKUP_MANIFEST_FORMAT = 1;

export const BACKUP_LEDGER_PATH = "ledger.db";

// blobs/sha256/<앞 2자>/<나머지 62자>. hash 길이가 바뀌면 경로도 같이 바뀐다.
export const BACKUP_BLOB_PATH = /^blobs\/sha256\/[0-9a-f]{2}\/[0-9a-f]{62}$/;

export const BACKUP_INTEGRITY = ["passed", "failed"] as const;

export const backupIntegritySchema = z.enum(BACKUP_INTEGRITY);

export type BackupIntegrity = z.infer<typeof backupIntegritySchema>;

// 자동 포함하지 않는 범위.
export const BACKUP_EXCLUSIONS = [
  "app_db",
  "external_source",
  "keychain",
  "credential",
] as const;

export const backupExclusionSchema = z.enum(BACKUP_EXCLUSIONS);

export type BackupExclusion = z.infer<typeof backupExclusionSchema>;

export const backupBlobSchema = z.object({
  hash: sha256Schema,
  size_bytes: z.number().refine(
    (n): n is number => Number.isSafeInteger(n) && n >= 0,
    { message: "invalid blob size" },
  ),
  path: z.string().regex(BACKUP_BLOB_PATH),
}).refine(
  (value) =>
    value.path ===
      `blobs/sha256/${value.hash.slice(0, 2)}/${value.hash.slice(2)}`,
  { message: "blob path does not match hash" },
);

export type BackupBlob = z.infer<typeof backupBlobSchema>;

export const backupManifestSchema = z.object({
  format: z.literal(BACKUP_MANIFEST_FORMAT),
  schema_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  through_seq: seqSchema,
  created_at: atSchema,
  ledger_hash: sha256Schema,
  ledger_path: z.literal(BACKUP_LEDGER_PATH),
  blobs: z.array(backupBlobSchema),
  settings: z.literal("ledger"),
  integrity: backupIntegritySchema,
  complete: z.boolean(),
  excluded: z.array(backupExclusionSchema),
}).refine(
  (value) =>
    new Set(value.blobs.map((blob) => blob.hash)).size ===
      value.blobs.length,
  { message: "duplicate blob hash" },
).refine(
  (value) => value.complete === (value.integrity === "passed"),
  { message: "only a passed check can be complete" },
).refine(
  (value) =>
    BACKUP_EXCLUSIONS.every((exclusion) => value.excluded.includes(exclusion)),
  { message: "excluded scope must name every automatic omission" },
);

export type BackupManifest = z.infer<typeof backupManifestSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const backupsList = defineRead({
  resource: "backups",
  method: "list",
  name: "ListBackups",
  input: z.strictObject({}),
  output: withReadCommon(z.object({
    backups: z.array(backupManifestSchema),
  })),
  actors: BACKUP_READERS,
  errors: readErrors,
});

export const backupsGet = defineRead({
  resource: "backups",
  method: "get",
  name: "GetBackup",
  input: z.strictObject({ created_at: atSchema }),
  output: withReadCommon(z.object({ manifest: backupManifestSchema })),
  actors: BACKUP_READERS,
  errors: readErrors,
});

export const BACKUP_ROUTES = [backupsList, backupsGet] as const;
