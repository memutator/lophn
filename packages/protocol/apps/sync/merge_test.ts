import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  applyRemote,
  type Clock,
  decodePk,
  dumpClocks,
  dumpData,
  ensureSyncTables,
  hlcAtMs,
  type IncomingChange,
  mergeSnapshot,
  openClock,
  type SyncDb,
  setState,
  stampLocal,
} from "./mod.ts";
import { nodeSyncDb } from "./node-db.ts";

// 기계 사이 snapshot 합치기. 사본마다 raw(serialize용)와 SyncDb를 쥔다.
type Replica = { raw: DatabaseSync; db: SyncDb; clock: Clock };

const SCHEMA = [
  "create table item (id text primary key, title text, done integer, note text)",
  "create table tag (k text, n integer, v text, primary key (k, n))",
];

function base(rows: string[]): Uint8Array {
  const raw = new DatabaseSync(":memory:");
  for (const sql of SCHEMA) raw.exec(sql);
  const db = nodeSyncDb(raw);
  ensureSyncTables(db, "base");
  // base row도 clock이 있다: 기계 사이 stream은 clock이 있는 snapshot에서 시작한다.
  write({ raw, db, clock: openClock(db) }, 100, rows);
  return raw.serialize();
}

function replica(bytes: Uint8Array, node: string): Replica {
  const raw = new DatabaseSync(":memory:");
  raw.deserialize(bytes);
  raw.exec("pragma foreign_keys = off");
  const db = nodeSyncDb(raw);
  setState(db, "node", node);
  return { raw, db, clock: openClock(db) };
}

const copy = (r: Replica, node: string) => replica(r.raw.serialize(), node);

function inTransaction<T>(db: SyncDb, work: () => T): T {
  db.exec("begin immediate");
  const out = work();
  db.exec("commit");
  return out;
}

// 컴퓨터 runtime의 write: write, changeset, clock 찍기가 한 transaction.
function write(r: Replica, at: number, sql: string[]): IncomingChange {
  return inTransaction(r.db, () => {
    const session = r.db.session();
    for (const statement of sql) r.db.exec(statement);
    const changeset = session.changeset();
    session.close();
    const hlc = r.clock.next(at);
    assert.ok(stampLocal(r.db, changeset, hlc).ok);
    return { hlc, changeset };
  });
}

function apply(r: Replica, changes: IncomingChange[]): void {
  inTransaction(r.db, () => {
    assert.ok(applyRemote(r.db, changes, r.clock).ok);
  });
}

function merge(r: Replica, source: Replica) {
  return inTransaction(r.db, () => mergeSnapshot(r.db, source.db, r.clock));
}

const dump = (r: Replica) => `${dumpData(r.db)}\n--\n${dumpClocks(r.db)}`;

test("merging a snapshot equals applying its changes one by one", () => {
  const start = base([
    "insert into item values ('a', 'milk', 0, null), ('b', 'eggs', 0, null), ('c', 'tea', 0, null), ('d', 'jam', 0, null)",
    "insert into tag values ('x', 1, 'one'), ('x', 2, 'two')",
  ]);
  const a = replica(start, "a");
  const b = replica(start, "b");
  const c = replica(start, "c");

  const fromC = [
    write(c, 1000, ["update item set title = 'milk C' where id = 'a'"]),
    write(c, 1100, ["insert into item values ('c3', 'from C', 0, 'c')"]),
    write(c, 1200, ["delete from item where id = 'b'"]),
  ];
  apply(a, fromC);
  const fromA = [
    write(a, 2000, [
      "update item set done = 1 where id = 'a'",
      "update item set note = 'A' where id = 'c'",
    ]),
    write(a, 2100, ["delete from item where id = 'd'"]),
    write(a, 2200, [
      "insert into item values ('a2', 'from A', 1, null)",
      "update tag set v = 'A' where k = 'x' and n = 1",
    ]),
    write(a, 2300, ["delete from tag where k = 'x' and n = 2"]),
  ];

  write(b, 500, ["update item set title = 'milk B' where id = 'a'"]);
  write(b, 900, ["update item set title = 'jam B' where id = 'd'"]);
  write(b, 1500, ["insert into item values ('b9', 'from B', 0, null)"]);
  write(b, 1900, ["update tag set v = 'B' where k = 'x' and n = 2"]);
  write(b, 2500, ["update item set done = 1 where id = 'c'"]);
  write(b, 3000, ["update item set note = 'B newer' where id = 'a'"]);

  const merged = copy(b, "b");
  assert.ok(merge(merged, a).ok);
  const stepwise = copy(b, "b");
  apply(stepwise, [...fromC, ...fromA]);

  assert.equal(dump(merged), dump(stepwise));
  // 받는 쪽만 더 새 clock으로 고친 칸은 남는다.
  assert.ok(
    dumpData(merged.db).split("\n").includes("'a'|'milk C'|1|'B newer'"),
    dumpData(merged.db),
  );

  const once = dump(merged);
  assert.ok(merge(merged, a).ok);
  assert.equal(dump(merged), once, "merging the same snapshot twice");

  const other = copy(a, "a");
  other.raw.exec("alter table tag add column extra text");
  const target = copy(b, "b");
  const before = dump(target);
  inTransaction(target.db, () => {
    const result = mergeSnapshot(target.db, other.db, target.clock);
    assert.equal(!result.ok && result.error.code, "conflict");
    assert.equal(dump(target), before, "nothing written on a shape mismatch");
  });
});

test("absent deletes spare kept rows and rows with newer clocks", () => {
  const start = base(["insert into item values ('s1', 'shared', 0, null)"]);
  const source = replica(start, "x");
  const back = replica(start, "n");
  write(back, 1000, [
    "insert into item values ('o1', 'gone elsewhere', 0, null), ('o2', 'held', 0, null), ('o3', 'edited later', 0, null)",
  ]);
  write(back, 5000, [
    "update item set note = 'new' where id = 'o3'",
    "insert into item values ('o4', 'new row', 0, null)",
  ]);

  const below = hlcAtMs(3000);
  const result = inTransaction(back.db, () =>
    mergeSnapshot(back.db, source.db, back.clock, {
      absentDeletes: {
        below,
        keep: (table, pk) => table === "item" && decodePk(pk)[0] === "o2",
      },
    }),
  );
  assert.ok(result.ok);
  assert.equal(result.value.deleted, 1);
  const ids = back.db
    .all("select id from item order by id")
    .map((row) => row["id"]);
  assert.deepEqual(ids, ["o2", "o3", "o4", "s1"]);
  const tombstones = back.db.all(
    "select pk, cast(hlc as text) as hlc from lophn_sync_row where deleted = 1",
  );
  assert.equal(tombstones.length, 1);
  assert.deepEqual(decodePk(tombstones[0]!["pk"] as Uint8Array), ["o1"]);
  assert.equal(tombstones[0]!["hlc"], String(below));
});
