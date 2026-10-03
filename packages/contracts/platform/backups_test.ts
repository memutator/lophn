import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  BACKUP_EXCLUSIONS,
  BACKUP_MANIFEST_FORMAT,
  BACKUP_ROUTES,
  backupManifestSchema,
  backupsGet,
  backupsList,
} from "./backups.ts";
import { routePath } from "./route.ts";

const at = "2026-10-04T00:00:00.000Z";
const hash = "ab".padEnd(64, "c");
const meta = { as_of_seq: "7", next_cursor: null };

const manifest = {
  format: BACKUP_MANIFEST_FORMAT,
  schema_version: 3,
  through_seq: "41",
  created_at: at,
  ledger_hash: "d".repeat(64),
  ledger_path: "ledger.db",
  blobs: [{
    hash,
    size_bytes: 12,
    path: `blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
  }],
  settings: "ledger",
  integrity: "passed",
  complete: true,
  excluded: [...BACKUP_EXCLUSIONS],
};

Deno.test("platform/backup-and-migration#R8: backup read 이름은 architecture 5.1과 같다", () => {
  assertEquals(BACKUP_ROUTES.map(routePath), [
    "/v1/backups/list",
    "/v1/backups/get",
  ]);
  for (const route of BACKUP_ROUTES) {
    assertEquals(route.kind, "read");
    assert(route.actors.length === 5);
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
});

Deno.test("platform/backup-and-migration#R8, platform/backup-and-migration#R10, platform/backup-and-migration#R11: format 1 manifest와 검사 상태가 통과한다", () => {
  assert(
    backupsList.output.safeParse({ ...meta, backups: [manifest] }).success,
  );
  assert(
    backupsGet.output.safeParse({ ...meta, manifest }).success,
  );
  const failed = backupManifestSchema.safeParse({
    ...manifest,
    integrity: "failed",
    complete: true,
  });
  assert(!failed.success);
});

Deno.test("platform/backup-and-migration#R8, platform/backup-and-migration#R12: 모르는 field·틀린 값·틀린 경로를 거절한다", () => {
  assert(!backupsList.input.safeParse({ limit: 7 }).success);
  assert(!backupsGet.input.safeParse({ id: "bkp_01ary4jx0r0" }).success);
  assert(!backupsGet.input.safeParse({ created_at: "2026-10-04" }).success);
  assert(
    !backupManifestSchema.safeParse({ ...manifest, format: 2 }).success,
  );
  assert(
    !backupManifestSchema.safeParse({
      ...manifest,
      blobs: [{ ...manifest.blobs[0], path: "blobs/other" }],
    }).success,
  );
  assert(
    !backupManifestSchema.safeParse({
      ...manifest,
      excluded: ["app_db"],
    }).success,
  );
  assert(
    !backupManifestSchema.safeParse({
      ...manifest,
      blobs: [manifest.blobs[0], manifest.blobs[0]],
    }).success,
  );
});
