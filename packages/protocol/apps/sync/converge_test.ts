import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { encodePk } from "./changeset.ts";
import {
  adoptSnapshot,
  applyIncoming,
  applyRemote,
  type Clock,
  clockAhead,
  decodePk,
  dumpClocks,
  dumpData,
  ensureSyncTables,
  hlcAtMs,
  type IncomingChange,
  msOfHlc,
  openClock,
  readOutbox,
  type SyncDb,
  stampLocal,
  stampOutbox,
} from "./mod.ts";
import { nodeSyncDb } from "./node-db.ts";

// 두 replica(컴퓨터 c와 폰 p)가 같은 base에서 시작해 각자 쓰고 서로의 변경을 받는다. 같은 변경 목록을 두
// 순서로 받은 새 replica 둘까지 넷의 data dump와 clock dump가 같아야 한다.
type Step = { side: "c" | "p"; at: number; sql: string[] };
type Case = {
  name: string;
  schema: string[];
  base: string[];
  steps: Step[];
  duplicate?: boolean;
  // 폰의 write가 clock 없이 outbox에 있는 채로 원격 변경을 받는다(찍기는 applyIncoming이 at 시각에 한다).
  unstamped?: boolean;
  expect?: string;
};

const ITEM =
  "create table item (id text primary key, title text, done integer, note text, score real, data blob)";
const ITEM_BASE = [
  "insert into item values ('a', 'milk', 0, null, 1.5, x'00ff')",
  "insert into item values ('b', 'eggs', 0, 'n', 2.0, null)",
];
const item = (name: string, steps: Step[], more: Partial<Case> = {}): Case => ({
  name,
  schema: [ITEM],
  base: ITEM_BASE,
  steps,
  ...more,
});

const CASES: Case[] = [
  item(
    "same column, computer later",
    [
      {
        side: "p",
        at: 1000,
        sql: ["update item set title = 'milk P' where id = 'a'"],
      },
      {
        side: "c",
        at: 2000,
        sql: ["update item set title = 'milk C' where id = 'a'"],
      },
    ],
    { expect: "'a'|'milk C'|0|NULL|1.5|X'00FF'" },
  ),
  item(
    "same column, phone later",
    [
      {
        side: "c",
        at: 1000,
        sql: ["update item set title = 'milk C' where id = 'a'"],
      },
      {
        side: "p",
        at: 2000,
        sql: ["update item set title = 'milk P' where id = 'a'"],
      },
    ],
    { expect: "'a'|'milk P'|0|NULL|1.5|X'00FF'" },
  ),
  item(
    "different columns",
    [
      {
        side: "p",
        at: 1000,
        sql: ["update item set title = 'milk P' where id = 'a'"],
      },
      { side: "c", at: 2000, sql: ["update item set done = 1 where id = 'a'"] },
    ],
    { expect: "'a'|'milk P'|1|NULL|1.5|X'00FF'" },
  ),
  item(
    "different columns applied twice",
    [
      {
        side: "p",
        at: 1000,
        sql: ["update item set title = 'milk P' where id = 'a'"],
      },
      {
        side: "c",
        at: 2000,
        sql: ["update item set done = 1, note = 'C' where id = 'a'"],
      },
    ],
    { duplicate: true, expect: "'a'|'milk P'|1|'C'|1.5|X'00FF'" },
  ),
  item(
    "delete, then a later update on the other side",
    [
      { side: "c", at: 1000, sql: ["delete from item where id = 'a'"] },
      {
        side: "p",
        at: 2000,
        sql: ["update item set title = 'milk P' where id = 'a'"],
      },
    ],
    { expect: "'b'|'eggs'|0|'n'|2.0|NULL" },
  ),
  item(
    "update, then a later delete on the other side",
    [
      {
        side: "p",
        at: 1000,
        sql: ["update item set title = 'milk P', done = 1 where id = 'a'"],
      },
      { side: "c", at: 2000, sql: ["delete from item where id = 'a'"] },
    ],
    { expect: "'b'|'eggs'|0|'n'|2.0|NULL" },
  ),
  item(
    "insert and insert of one id",
    [
      {
        side: "c",
        at: 1000,
        sql: [
          "insert into item values ('x', 'from C', 0, 'c-note', 1.0, null)",
        ],
      },
      {
        side: "p",
        at: 2000,
        sql: ["insert into item values ('x', 'from P', 1, null, 2.5, x'01')"],
      },
    ],
    { expect: "'x'|'from P'|1|NULL|2.5|X'01'" },
  ),
  item(
    "tombstone against a later insert",
    [
      { side: "p", at: 500, sql: ["delete from item where id = 'b'"] },
      { side: "c", at: 1000, sql: ["delete from item where id = 'b'"] },
      {
        side: "p",
        at: 3000,
        sql: ["insert into item values ('b', 'again', 0, null, null, null)"],
      },
    ],
    { expect: "'b'|'again'|0|NULL|NULL|NULL" },
  ),
  item("insert against a newer tombstone", [
    { side: "p", at: 500, sql: ["delete from item where id = 'b'"] },
    {
      side: "p",
      at: 1000,
      sql: ["insert into item values ('b', 'again', 0, null, null, null)"],
    },
    { side: "c", at: 3000, sql: ["delete from item where id = 'b'"] },
  ]),
  {
    name: "types",
    schema: [
      ITEM,
      "create table anyv (k text primary key, v)",
      "create table rk (k real primary key, v text)",
      "create table bk (k blob primary key, v text)",
    ],
    base: [
      ...ITEM_BASE,
      "insert into anyv values ('i', 7), ('r', 7.0), ('t', '7'), ('n', null)",
      "insert into rk values (2.5, 'two and a half')",
      "insert into bk values (x'cafe', 'blob key')",
    ],
    steps: [
      {
        side: "c",
        at: 1000,
        sql: [
          "insert into item values ('t1', '한글 ✓ 😀 \"q\" ''s''', -9223372036854775808, null, 0.1, x'000102')",
          "insert into item values ('t2', '', 9223372036854775807, '', -0.0, x'')",
          "update anyv set v = 8.0 where k = 'i'",
          "update rk set v = 'c' where k = 2.5",
          "insert into bk values (x'00', 'zero byte key')",
        ],
      },
      {
        side: "p",
        at: 1100,
        sql: [
          "update item set score = 3.0, note = null, data = x'' where id = 'a'",
          "update anyv set v = x'0700' where k = 'r'",
          "update anyv set v = 1e308 where k = 't'",
          "insert into rk values (1.25, 'p real key')",
          "update bk set v = 'p' where k = x'cafe'",
        ],
      },
    ],
    expect: "'t2'|''|9223372036854775807|''|0.0|X''",
  },
  {
    name: "three-column primary key",
    schema: [
      "create table cell (sheet text, r integer, c integer, v, primary key (sheet, r, c))",
    ],
    base: [
      "insert into cell values ('s1', 1, 1, 'a'), ('s1', 1, 2, 'b'), ('s1', 2, 1, 'c')",
    ],
    steps: [
      {
        side: "c",
        at: 1000,
        sql: [
          "update cell set v = 'A' where sheet = 's1' and r = 1 and c = 1",
          "insert into cell values ('s2', 1, 1, 'new')",
        ],
      },
      {
        side: "p",
        at: 1500,
        sql: [
          "update cell set v = 'B' where sheet = 's1' and r = 1 and c = 2",
          "delete from cell where sheet = 's1' and r = 2 and c = 1",
        ],
      },
      {
        side: "c",
        at: 2000,
        sql: ["update cell set v = 'C' where sheet = 's1' and r = 2 and c = 1"],
      },
    ],
    expect: "'s1'|1|2|'B'",
  },
  item(
    "phone write still unstamped when a remote change arrives",
    [
      {
        side: "c",
        at: 2000,
        sql: ["update item set title = 'milk C', done = 1 where id = 'a'"],
      },
      {
        side: "p",
        at: 3000,
        sql: [
          "update item set title = 'milk P' where id = 'a'",
          "delete from item where id = 'b'",
        ],
      },
    ],
    { unstamped: true, expect: "'a'|'milk P'|1|NULL|1.5|X'00FF'" },
  ),
];

function open(bytes: Uint8Array): SyncDb {
  const raw = new DatabaseSync(":memory:");
  raw.deserialize(bytes);
  raw.exec("pragma foreign_keys = off");
  return nodeSyncDb(raw);
}

function inTransaction<T>(db: SyncDb, work: () => T): T {
  db.exec("begin immediate");
  const out = work();
  db.exec("commit");
  return out;
}

function recorded(db: SyncDb, sql: string[]): Uint8Array {
  const session = db.session();
  for (const statement of sql) db.exec(statement);
  const changeset = session.changeset();
  session.close();
  return changeset;
}

// 컴퓨터 runtime: write, changeset, clock 찍기가 한 transaction.
function computerWrite(db: SyncDb, clock: Clock, step: Step): IncomingChange {
  return inTransaction(db, () => {
    const changeset = recorded(db, step.sql);
    const hlc = clock.next(step.at);
    assert.ok(stampLocal(db, changeset, hlc).ok);
    return { hlc, changeset };
  });
}

// 폰 native module: guest 호출의 write와 outbox 줄이 한 transaction. clock은 host가 나중에 찍는다.
function phoneWrite(db: SyncDb, id: string, step: Step): void {
  inTransaction(db, () => {
    const changeset = recorded(db, step.sql);
    db.run(
      "insert into lophn_sync_outbox (id, operation, started_at, changeset) values (?, 'edit', '2026-11-15T00:00:00Z', ?)",
      [id, changeset],
    );
  });
}

function apply(db: SyncDb, changes: IncomingChange[]): void {
  inTransaction(db, () => {
    assert.ok(applyRemote(db, changes, openClock(db)).ok);
  });
}

function run(c: Case) {
  const baseRaw = new DatabaseSync(":memory:");
  for (const sql of [...c.schema, ...c.base]) baseRaw.exec(sql);
  ensureSyncTables(nodeSyncDb(baseRaw), "computer");
  const base = baseRaw.serialize();

  const computer = open(base);
  const phone = open(base);
  adoptSnapshot(phone, { node: "phone", cursor: "0", release: "r1" });
  const computerClock = openClock(computer);
  const phoneClock = openClock(phone);

  const fromComputer: IncomingChange[] = [];
  c.steps.forEach((step, i) => {
    if (step.side === "c") {
      fromComputer.push(computerWrite(computer, computerClock, step));
      return;
    }
    phoneWrite(phone, `0${i}`, step);
    if (!c.unstamped) {
      inTransaction(phone, () => {
        assert.ok(stampOutbox(phone, phoneClock, step.at).ok);
      });
    }
  });

  // 폰 host의 pull: 같은 transaction에서 찍기 먼저, 그다음 적용.
  const phoneAt = Math.max(
    ...c.steps.filter((s) => s.side === "p").map((s) => s.at),
  );
  for (let round = 0; round < (c.duplicate ? 2 : 1); round++) {
    inTransaction(phone, () => {
      assert.ok(applyIncoming(phone, fromComputer, phoneClock, phoneAt).ok);
    });
  }
  const fromPhone = readOutbox(phone).map((row) => ({
    hlc: row.hlc!,
    changeset: row.changeset,
  }));
  apply(computer, fromPhone);
  if (c.duplicate) apply(computer, fromPhone);

  const replica = (first: IncomingChange[], second: IncomingChange[]) => {
    const db = open(base);
    adoptSnapshot(db, { node: "replica", cursor: "0", release: "r1" });
    apply(db, first);
    apply(db, second);
    return db;
  };
  return [
    computer,
    phone,
    replica(fromComputer, fromPhone),
    replica(fromPhone, fromComputer),
  ];
}

for (const c of CASES) {
  test(`two replicas converge: ${c.name}`, () => {
    const replicas = run(c);
    const data = replicas.map(dumpData);
    const clocks = replicas.map(dumpClocks);
    for (let i = 1; i < replicas.length; i++) {
      assert.equal(data[i], data[0], `data of replica ${i}`);
      assert.equal(clocks[i], clocks[0], `clocks of replica ${i}`);
    }
    if (c.expect) assert.ok(data[0]!.split("\n").includes(c.expect), data[0]);
  });
}

test("clock keeps rising when the wall clock goes back", () => {
  const db = nodeSyncDb(new DatabaseSync(":memory:"));
  ensureSyncTables(db, "computer");
  const first = openClock(db).next(5000);
  const second = openClock(db).next(1000);
  const third = openClock(db).next(1000);
  assert.ok(first < second && second < third);
  assert.ok(msOfHlc(third) >= 5000);

  const now = 1_800_000_000_000;
  const minute = 60_000;
  assert.equal(msOfHlc(hlcAtMs(now)), now);
  assert.equal(
    clockAhead(hlcAtMs(now + 10 * minute), now, 5 * minute),
    10 * minute,
  );
  assert.equal(clockAhead(hlcAtMs(now + 4 * minute), now, 5 * minute), 0);
});

test("decodePk reverses encodePk", () => {
  const keys = [
    [BigInt("-9223372036854775808")],
    [BigInt("9223372036854775807"), BigInt(0), BigInt(-1)],
    [2.5, -1e308, 0.1],
    ["", "한글 ✓ 😀", "x".repeat(300)],
    [new Uint8Array([0, 255]), new Uint8Array(0), new Uint8Array(200)],
    [BigInt(7), 1.25, "mixed", new Uint8Array([1])],
  ];
  for (const key of keys) {
    const blob = encodePk(
      key,
      key.map(() => true),
    );
    assert.deepEqual(decodePk(blob), key);
  }
});
