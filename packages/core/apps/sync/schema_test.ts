import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { manualClock, ok, type Result } from "../../../base/mod.ts";
import type { AppInvocation } from "../../../protocol/apps/calls/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../storage/ledger/schema.ts";
import { applyMigrations } from "../../storage/migration/migrations.ts";
import { createSyncLog } from "./log.ts";
import { SYNC_LOG_MACHINE_STEPS, SYNC_LOG_SCHEMA_STEPS } from "./schema.ts";
import { syncPlanOf } from "../../../protocol/apps/declaration/sync-plan.ts";

const clock = manualClock(Date.parse("2026-11-16T00:00:00.000Z"));
const hash = (n: number) => String(n).repeat(64);
const bytesOf = (n: number) => new Uint8Array([n, n + 1, n + 2]);

const rowsOf = (db: DatabaseSync, text: string) =>
  db
    .prepare(text)
    .all()
    .map((row) => ({ ...row }));

// 사람의 ledger가 이 step을 돈다. seq가 바뀌면 blob 참조(owner_key = seq)가 어긋나 changeset bytes를 잃고, 다음 번호가
// 작아지면 이미 그 번호를 넘긴 폰의 cursor가 새 줄을 건너뛴다.
test("apps.sync-log.machine으로 표를 다시 만들어도 모든 행과 seq와 changeset이 그대로이고 다음 seq는 지운 번호를 다시 쓰지 않는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-sync-log-machine-"));
  const path = join(dir, "ledger.sqlite");
  const before = [...LEDGER_SCHEMA_STEPS, ...SYNC_LOG_SCHEMA_STEPS];
  assert.ok((await applyMigrations(path, before, { clock })).ok);

  const db = new DatabaseSync(path);
  const insert = db.prepare(
    `insert into app_sync_log (app, release, kind, origin, device, change_id, hlc, changeset_hash, changeset_size,
       invocation, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ref = db.prepare(
    `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
     values ('app_sync_log', ?, 'changeset', ?, 3, 0)`,
  );
  const at = "2026-11-16T00:00:00.000Z";
  // 앱 둘에 걸친 change·skipped·snapshot과 computer·device·rewind. 끝의 둘은 지운다(blob 참조는 남은 줄에만 둔다).
  const rows = [
    ["app_1", "rel_1", "change", "computer", null, null, "1", 1, "inv_1"],
    ["app_1", "rel_1", "change", "device", "dev_1", "c1", "2", 2, "inv_2"],
    ["app_1", "rel_1", "skipped", "device", "dev_1", "c2", "3", null, "inv_3"],
    ["app_2", "rel_2", "change", "rewind", null, null, "4", 3, null],
    ["app_2", "rel_2", "snapshot", "computer", null, null, null, null, "inv_4"],
    ["app_1", "rel_1", "change", "computer", null, null, "5", 4, "inv_5"],
    ["app_2", "rel_2", "change", "device", "dev_2", "c3", "6", 5, "inv_6"],
  ] as const;
  for (const [app, rel, kind, origin, device, change, hlc, blob, inv] of rows) {
    const done = insert.run(
      app,
      rel,
      kind,
      origin,
      device,
      change,
      hlc,
      blob === null ? null : hash(blob),
      blob === null ? null : 3,
      inv,
      at,
    );
    if (blob !== null && blob <= 3) {
      ref.run(String(done.lastInsertRowid), hash(blob));
    }
  }
  db.exec("delete from app_sync_log where seq in (6, 7)");
  const keptRows = rowsOf(db, "select * from app_sync_log order by seq");
  const keptRefs = rowsOf(db, "select * from blob_refs order by rowid");
  const sequence = () =>
    Number(
      db
        .prepare("select seq from sqlite_sequence where name = 'app_sync_log'")
        .get()!["seq"],
    );
  assert.equal(sequence(), 7);
  db.close();

  const applied = await applyMigrations(
    path,
    [...before, ...SYNC_LOG_MACHINE_STEPS],
    { clock },
  );
  assert.deepEqual(applied.ok && applied.value, 1);

  const after = new DatabaseSync(path);
  assert.deepEqual(
    rowsOf(after, "select * from app_sync_log order by seq"),
    keptRows.map((row) => ({ ...row, machine: null, resolved_at: null })),
  );
  assert.deepEqual(
    rowsOf(after, "select * from blob_refs order by rowid"),
    keptRefs,
  );
  assert.equal(
    Number(
      after
        .prepare("select seq from sqlite_sequence where name = 'app_sync_log'")
        .get()!["seq"],
    ),
    7,
  );
  assert.deepEqual(
    rowsOf(
      after,
      "select name from sqlite_master where type = 'index' and tbl_name = 'app_sync_log' and sql is not null order by name",
    ).map((row) => row["name"]),
    [
      "app_sync_log_app_seq",
      "app_sync_log_device_change",
      "app_sync_log_invocation",
      "app_sync_log_machine_change",
    ],
  );

  const sql: Sql = {
    run: (text, params) => after.prepare(text).run(...params),
    get: (text, params) => after.prepare(text).get(...params) as never,
    all: (text, params) => after.prepare(text).all(...params) as never,
  };
  const tx = { sql, now: () => clock.now() } as unknown as Tx;
  const stored = new Map([1, 2, 3].map((n) => [hash(n), bytesOf(n)] as const));
  const log = createSyncLog({
    sql,
    transaction<T>(fn: (tx: Tx) => Result<T>) {
      return fn(tx);
    },
    blobs: {
      prepare: () => Promise.reject(new Error("unused")),
      read: (key: string, offset: number, length: number) =>
        Promise.resolve(
          ok({
            hash: key,
            sizeBytes: 3,
            bytes: stored.get(key)!.slice(offset, offset + length),
          }),
        ),
    },
    ledger: { list: () => ok([]) },
    activeRelease: () => ok(null),
    plan: () => syncPlanOf({ runs_on: ["computer", "phone"] }),
    now: () => clock.now(),
    changed: () => {},
  });
  for (const [app, blobs] of [
    ["app_1", [1, 2]],
    ["app_2", [3]],
  ] as const) {
    const changes = log
      .page(app, 0, 100)
      .filter((row) => row.kind === "change");
    assert.deepEqual(
      changes.map((row) => row.changeset?.hash),
      blobs.map(hash),
    );
    for (const [i, row] of changes.entries()) {
      const read = await log.readChangeset(row.changeset!.hash, 3);
      assert.deepEqual(read.ok && read.value, bytesOf(blobs[i]!));
      assert.ok(
        keptRefs.some(
          (one) =>
            one["owner_key"] === String(row.seq) &&
            one["hash"] === row.changeset!.hash,
        ),
      );
    }
  }

  // 다른 기계의 snapshot을 합친 줄이 새 표의 CHECK를 지난다.
  const next = await log.merged({
    id: "inv_merge",
    app: "app_1",
    release: "rel_1",
    caller: {
      kind: "person",
      view_session: "snapshot:3",
      machine: "mch_01hzzzzzzzzzzzzzzzzzzzzzzz",
    },
  } as unknown as AppInvocation);
  assert.deepEqual(next.ok && next.value, 8);
  assert.deepEqual(
    log.page("app_1", 7, 10).map((row) => [row.kind, row.origin, row.machine]),
    [["snapshot", "machine", "mch_01hzzzzzzzzzzzzzzzzzzzzzzz"]],
  );
  after.close();
});
