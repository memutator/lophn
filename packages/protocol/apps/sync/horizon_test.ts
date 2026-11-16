import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  adoptSnapshot,
  applyRemote,
  type Clock,
  dropTombstones,
  dumpClocks,
  dumpData,
  ensureSyncTables,
  getState,
  hlcAtMs,
  type IncomingChange,
  openClock,
  type SyncDb,
  setState,
  stampLocal,
  unsafePastHorizon,
} from "./mod.ts";
import { nodeSyncDb } from "./node-db.ts";

type Replica = { raw: DatabaseSync; db: SyncDb; clock: Clock };

function replica(bytes: Uint8Array | null, node: string): Replica {
  const raw = new DatabaseSync(":memory:");
  if (bytes !== null) raw.deserialize(bytes);
  raw.exec("pragma foreign_keys = off");
  const db = nodeSyncDb(raw);
  if (bytes === null) ensureSyncTables(db, node);
  else setState(db, "node", node);
  return { raw, db, clock: openClock(db) };
}

function inTransaction<T>(db: SyncDb, work: () => T): T {
  db.exec("begin immediate");
  const out = work();
  db.exec("commit");
  return out;
}

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

function apply(r: Replica, changes: IncomingChange[]) {
  return inTransaction(r.db, () => {
    const result = applyRemote(r.db, changes, r.clock);
    assert.ok(result.ok);
    return result.value;
  });
}

const dump = (r: Replica) => `${dumpData(r.db)}\n--\n${dumpClocks(r.db)}`;

test("dropping tombstones never lets an older change through silently", () => {
  const start = replica(null, "base");
  start.raw.exec(
    "create table item (id text primary key, title text, note text)",
  );
  write(start, 100, [
    "insert into item values ('a', 'milk', null), ('b', 'eggs', null), ('c', 'tea', null), ('d', 'jam', null)",
  ]);
  const bytes = start.raw.serialize();
  const x = replica(bytes, "x");
  const y = replica(bytes, "y");

  // y의 옛 변경들: x가 a를 지운 것(2000)보다 옛 update·delete·insert.
  const old = [
    write(y, 1000, ["update item set title = 'milk Y' where id = 'a'"]),
    write(y, 1100, ["delete from item where id = 'a'"]),
    write(y, 1200, ["insert into item values ('a', 'milk again', null)"]),
  ];
  const traced = write(y, 1300, [
    "update item set title = 'eggs Y' where id = 'b'",
  ]);
  const mixed = write(y, 1400, [
    "update item set note = 'mixed' where id in ('a', 'c')",
  ]);
  const later = [
    write(y, 8000, ["delete from item where id = 'a'"]),
    write(y, 9000, ["insert into item values ('a', 'milk later', null)"]),
  ];

  write(x, 2000, ["delete from item where id = 'a'"]);
  write(x, 5000, ["delete from item where id = 'd'"]);
  assert.equal(
    inTransaction(x.db, () => dropTombstones(x.db, hlcAtMs(3000))),
    1,
  );
  const horizon = getState(x.db, "horizon");
  assert.ok(horizon !== null && BigInt(horizon) < hlcAtMs(3000));
  // horizon은 내려가지 않고, 더 새 흔적(d)은 남는다.
  assert.equal(
    inTransaction(x.db, () => dropTombstones(x.db, hlcAtMs(1000))),
    0,
  );
  assert.equal(getState(x.db, "horizon"), horizon);
  assert.match(dumpClocks(x.db), /\|1$/m);

  const before = dump(x);
  for (let round = 0; round < 2; round++) {
    const stats = apply(x, old);
    assert.deepEqual(stats.held, [0, 1, 2]);
    assert.equal(
      dump(x),
      before,
      `held changes leave the db as it was (${round})`,
    );
  }
  assert.ok(unsafePastHorizon(x.db, old[2]!));
  assert.ok(!unsafePastHorizon(x.db, traced));

  // 흔적이 있는 row의 옛 변경은 지금처럼 적용되고, 정리된 row를 건드리는 변경은 통째로 held다.
  const stats = apply(x, [traced, mixed]);
  assert.deepEqual(stats.held, [1]);
  const data = dumpData(x.db).split("\n");
  assert.ok(data.includes("'b'|'eggs Y'|NULL"), data.join("\n"));
  assert.ok(data.includes("'c'|'tea'|NULL"), data.join("\n"));

  // horizon보다 새 변경은 들어온다.
  assert.deepEqual(apply(x, later).held, []);
  assert.ok(
    dumpData(x.db).split("\n").includes("'a'|'milk later'|NULL"),
    dumpData(x.db),
  );

  // 폰은 흔적을 정리하지 않는다: 컴퓨터의 snapshot을 받아도 horizon이 없다.
  const phone = replica(x.raw.serialize(), "phone");
  adoptSnapshot(phone.db, { node: "phone", cursor: "0", release: "r1" });
  assert.equal(getState(phone.db, "horizon"), null);
});

test("dropping a tombstone drops its kept columns, and only when all are old", () => {
  const start = replica(null, "base");
  start.raw.exec("create table item (id text primary key, title text)");
  write(start, 100, ["insert into item values ('a', 'milk'), ('b', 'eggs')"]);
  const bytes = start.raw.serialize();
  const x = replica(bytes, "x");
  const y = replica(bytes, "y");
  const late = [
    write(y, 2500, ["update item set title = 'milk Y' where id = 'a'"]),
    write(y, 4500, ["update item set title = 'eggs Y' where id = 'b'"]),
  ];
  write(x, 2000, [
    "delete from item where id = 'a'",
    "delete from item where id = 'b'",
  ]);
  apply(x, late);
  assert.equal((dumpClocks(x.db).match(/^kept /gm) ?? []).length, 2);

  // a: 흔적 2000과 kept 2500이 모두 3000 아래라 같이 지운다. b: kept 4500이 남아 묘비도 남는다.
  assert.equal(
    inTransaction(x.db, () => dropTombstones(x.db, hlcAtMs(3000))),
    1,
  );
  const clocks = dumpClocks(x.db).split("\n");
  assert.equal(clocks.filter((l) => l.startsWith("row ")).length, 1);
  assert.equal(clocks.filter((l) => l.startsWith("kept ")).length, 1);
  assert.equal(getState(x.db, "horizon"), String(late[0]!.hlc));
});
