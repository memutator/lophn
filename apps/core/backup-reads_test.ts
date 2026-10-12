import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";

import {
  applyMigrations,
  backupStamp,
  createBackup,
} from "../../packages/core/storage/migration/mod.ts";
import { manualClock } from "../../packages/base/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../packages/core/storage/ledger/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../packages/core/config/mod.ts";
import { backupReads } from "./backup-reads.ts";

const AT = "2026-10-09T01:02:03.000Z";

async function fixture(): Promise<
  { root: string; ledgerPath: string; version: number; head: string }
> {
  const root = await Deno.makeTempDir({ prefix: "lophn-backup-reads-" });
  const ledgerPath = `${root}/lophn.db`;
  const steps = [...LEDGER_SCHEMA_STEPS, ...SETTINGS_SCHEMA_STEPS];
  const applied = await applyMigrations(ledgerPath, steps, {
    clock: manualClock(Date.parse(AT)),
  });
  assert(applied.ok);
  const db = new DatabaseSync(ledgerPath, { readOnly: true });
  const row = db.prepare("select coalesce(max(seq), 0) as seq from events")
    .get() as { seq: number | bigint };
  db.close();
  return { root, ledgerPath, version: steps.length, head: String(row.seq) };
}

Deno.test("platform/backup-and-migration#R10 backups/list returns finished bundles only with the ledger head", async () => {
  const { root, ledgerPath, version, head } = await fixture();
  try {
    const [list] = backupReads({ root, ledgerPath });
    const empty = await list.handle({} as never, {} as never);
    assert(empty.ok);
    assertEquals(empty.value, {
      backups: [],
      as_of_seq: head,
      next_cursor: null,
    });

    const stamp = backupStamp(AT);
    assert(stamp.ok);
    const created = await createBackup(ledgerPath, {
      root,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => AT,
    });
    assert(created.ok, created.ok ? "" : created.error.message);
    // manifest 없는 folder(만들기 중·중단)는 목록에 없다.
    await Deno.mkdir(`${root}/backups/20261009T000000000Z`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${root}/backups/20261009T000000000Z/lophn.db`,
      "x",
    );

    const listed = await list.handle({} as never, {} as never);
    assert(listed.ok);
    assertEquals(listed.value.backups.map((b) => b.created_at), [
      created.value.created_at,
    ]);
    assertEquals(listed.value.as_of_seq, head);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/backup-and-migration#R10 backups/get returns the manifest or not_found", async () => {
  const { root, ledgerPath, version, head } = await fixture();
  try {
    const [, get] = backupReads({ root, ledgerPath });
    assertEquals(typeof head, "string");
    const stamp = backupStamp(AT);
    assert(stamp.ok);
    const created = await createBackup(ledgerPath, {
      root,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => AT,
    });
    assert(created.ok);
    const found = await get.handle({} as never, {
      created_at: created.value.created_at,
    } as never);
    assert(found.ok);
    assertEquals(found.value.manifest, created.value);
    const missing = await get.handle({} as never, {
      created_at: "2020-01-01T00:00:00.000Z",
    } as never);
    assertEquals(missing.ok ? "ok" : missing.error.code, "not_found");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
