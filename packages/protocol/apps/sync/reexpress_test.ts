import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { sha256Hex } from "../../../base/hash.ts";
import {
  adoptSnapshot,
  applyRemote,
  dumpClocks,
  dumpData,
  ensureSyncTables,
  type MigrationStep,
  migrate,
  openClock,
  readOutbox,
  reexpress,
  type SyncDb,
  stampLocal,
  stampOutbox,
} from "./mod.ts";
import { nodeSyncDb } from "./node-db.ts";

const AT = "2026-11-15T00:00:00Z";

async function step(from: number, sql: string): Promise<MigrationStep> {
  return { from, to: from + 1, sql, sha256: `sha256:${await sha256Hex(sql)}` };
}

const V1 = step(
  0,
  `create table item (id text primary key, title text not null, done integer not null default 0, legacy text);
create table gone (id text primary key, v text);`,
);
const V2 = step(
  1,
  `-- loss: drop_column item.legacy
-- loss: drop_table gone
alter table item drop column legacy;
alter table item add column priority integer not null default 1;
drop table gone;
update item set title = title || '!';`,
);

function open(raw: DatabaseSync): SyncDb {
  raw.exec("pragma foreign_keys = off");
  return nodeSyncDb(raw);
}

function copy(raw: DatabaseSync): DatabaseSync {
  const out = new DatabaseSync(":memory:");
  out.deserialize(raw.serialize());
  return out;
}

function inTransaction(db: SyncDb, work: () => void): void {
  db.exec("begin immediate");
  work();
  db.exec("commit");
}

function computerWrite(db: SyncDb, at: number, sql: string): void {
  inTransaction(db, () => {
    const session = db.session();
    db.exec(sql);
    const changeset = session.changeset();
    session.close();
    assert.ok(stampLocal(db, changeset, openClock(db).next(at)).ok);
  });
}

// 폰 native module처럼 write와 outbox 줄을 한 transaction에 쓰고, host가 찍는다.
function phoneWrite(db: SyncDb, id: string, at: number, sql: string): void {
  inTransaction(db, () => {
    const session = db.session();
    db.exec(sql);
    const changeset = session.changeset();
    session.close();
    db.run(
      "insert into lophn_sync_outbox (id, operation, started_at, changeset) values (?, ?, ?, ?)",
      [id, `op ${id}`, AT, changeset],
    );
  });
  inTransaction(db, () => {
    assert.ok(stampOutbox(db, openClock(db), at).ok);
  });
}

async function migrated(db: SyncDb, steps: MigrationStep[], target: number) {
  return migrate(db, { steps, target, sha256: sha256Hex, appliedAt: AT });
}

// release r1의 컴퓨터와, r1 snapshot을 받아 안 보낸 변경을 쌓은 폰.
async function setup() {
  const computerRaw = new DatabaseSync(":memory:");
  const computer = open(computerRaw);
  assert.ok((await migrated(computer, [await V1], 1)).ok);
  computer.exec(
    "insert into item (id, title) values ('a', 'milk'), ('b', 'eggs'), ('c', 'tea'); insert into gone values ('g1', 'x')",
  );
  ensureSyncTables(computer, "computer");
  const phoneRaw = copy(computerRaw);
  const phone = open(phoneRaw);
  adoptSnapshot(phone, { node: "phone", cursor: "0", release: "r1" });

  phoneWrite(
    phone,
    "01",
    1000,
    "insert into item values ('n1', 'new', 0, 'L')",
  );
  phoneWrite(
    phone,
    "02",
    1001,
    "update item set title = 'milk P' where id = 'a'",
  );
  phoneWrite(
    phone,
    "03",
    1002,
    "update item set legacy = 'only legacy' where id = 'a'",
  );
  phoneWrite(phone, "04", 1003, "insert into gone values ('g2', 'y')");
  phoneWrite(phone, "05", 1004, "delete from item where id = 'b'");
  phoneWrite(
    phone,
    "06",
    1005,
    "update item set title = 'tea P', legacy = 'z' where id = 'c'",
  );
  computerWrite(computer, 500, "update item set done = 1 where id = 'c'");
  computerWrite(
    computer,
    2000,
    "update item set title = 'milk C' where id = 'a'",
  );
  return { computerRaw, computer, phoneRaw, phone };
}

test("a release change keeps unsent changes by name and drops only changes to dropped tables and columns", async () => {
  const { computerRaw, computer, phoneRaw, phone } = await setup();
  const steps = [await V1, await V2];

  // activation이 컴퓨터 DB를 올리고, 폰은 새 release의 snapshot과 local migrate한 사본을 쓴다.
  assert.ok((await migrated(computer, steps, 2)).ok);
  const snapshot = open(copy(computerRaw));
  adoptSnapshot(snapshot, { node: "phone", cursor: "9", release: "r2" });
  const local = open(copy(phoneRaw));
  assert.ok((await migrated(local, steps, 2)).ok);

  const result = reexpress({ old: phone, migrated: local, snapshot });
  assert.deepEqual(result, { ok: true, value: { kept: 3, dropped: 2 } });
  assert.equal(
    dumpData(snapshot),
    ["# item", "'a'|'milk C!'|0|1", "'c'|'tea P!'|1|1", "'n1'|'new!'|0|1"].join(
      "\n",
    ),
  );
  const outbox = readOutbox(snapshot);
  const before = new Map(readOutbox(phone).map((row) => [row.id, row]));
  assert.deepEqual(
    outbox.map((row) => row.id),
    ["01", "05", "06"],
  );
  for (const row of outbox) {
    const old = before.get(row.id)!;
    assert.deepEqual(
      [row.operation, row.started_at, row.hlc],
      [old.operation, old.started_at, old.hlc],
    );
  }

  // push: 컴퓨터가 다시 쓴 변경을 받으면 두 사본이 같다.
  inTransaction(computer, () => {
    const changes = outbox.map((row) => ({
      hlc: row.hlc!,
      changeset: row.changeset,
    }));
    assert.ok(applyRemote(computer, changes, openClock(computer)).ok);
  });
  assert.equal(dumpData(computer), dumpData(snapshot));
  assert.equal(dumpClocks(computer), dumpClocks(snapshot));
});

test("a failed migration leaves the database and its outbox as they were", async () => {
  const { phone } = await setup();
  const before = {
    data: dumpData(phone),
    clocks: dumpClocks(phone),
    outbox: readOutbox(phone),
  };
  const unchanged = () => {
    assert.equal(dumpData(phone), before.data);
    assert.equal(dumpClocks(phone), before.clocks);
    assert.deepEqual(readOutbox(phone), before.outbox);
  };

  const broken = await step(
    1,
    "alter table item add column extra text;\ninsert into nosuch values (1);",
  );
  const failed = await migrated(phone, [await V1, broken], 2);
  assert.equal(failed.ok ? null : failed.error.details?.["step"], "1-2");
  unchanged();

  const keyless = await step(
    1,
    "drop table gone;\ncreate table loose (v text);",
  );
  const refused = await migrated(phone, [await V1, keyless], 2);
  assert.equal(refused.ok ? null : refused.error.code, "invalid_input");
  unchanged();

  const changed = {
    ...(await V2),
    sql: `${(await V2).sql}\ndelete from item;`,
  };
  const mismatch = await migrated(phone, [await V1, changed], 2);
  assert.equal(
    mismatch.ok ? null : mismatch.error.message,
    "published migration script changed",
  );
  unchanged();
});
