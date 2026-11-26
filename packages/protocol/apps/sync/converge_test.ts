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
  setState,
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

// delete, 다시 insert, 칸 update가 두세 node에서 섞일 때. 받는 모든 순서(변경마다 한 번씩)와 각 node 자신의
// 사본이 같은 data와 clock에 닿아야 한다. delete는 자기보다 옛 것만 지운다: 더 새 칸 update는 row가 돌아올 때
// 남는다.
type Op = { node: string; at: number; sql: string };
const ROW_CASES: { name: string; ops: Op[]; expect: string | null }[] = [
  {
    name: "re-insert between a delete and a newer column update",
    ops: [
      { node: "a", at: 3000, sql: "delete from item where id = 'a'" },
      {
        node: "a",
        at: 4000,
        sql: "insert into item values ('a', 'A', 1, 'A', null, null)",
      },
      {
        node: "b",
        at: 5000,
        sql: "update item set title = 'B' where id = 'a'",
      },
    ],
    expect: "'a'|'B'|1|'A'|NULL|NULL",
  },
  {
    name: "re-insert newer than the column update",
    ops: [
      { node: "a", at: 3000, sql: "delete from item where id = 'a'" },
      {
        node: "b",
        at: 3500,
        sql: "update item set title = 'B' where id = 'a'",
      },
      {
        node: "a",
        at: 4000,
        sql: "insert into item values ('a', 'A', 1, 'A', null, null)",
      },
    ],
    expect: "'a'|'A'|1|'A'|NULL|NULL",
  },
  {
    name: "column update older than the delete",
    ops: [
      {
        node: "b",
        at: 2000,
        sql: "update item set title = 'B' where id = 'a'",
      },
      { node: "a", at: 3000, sql: "delete from item where id = 'a'" },
      {
        node: "a",
        at: 4000,
        sql: "insert into item values ('a', 'A', 1, 'A', null, null)",
      },
    ],
    expect: "'a'|'A'|1|'A'|NULL|NULL",
  },
  {
    name: "deleted row with a newer column update stays deleted",
    ops: [
      { node: "a", at: 3000, sql: "delete from item where id = 'a'" },
      {
        node: "b",
        at: 5000,
        sql: "update item set title = 'B' where id = 'a'",
      },
    ],
    expect: null,
  },
  {
    name: "three nodes: delete, re-insert elsewhere, two column updates",
    ops: [
      { node: "a", at: 3000, sql: "delete from item where id = 'a'" },
      { node: "c", at: 3200, sql: "update item set done = 7 where id = 'a'" },
      { node: "c", at: 3300, sql: "delete from item where id = 'a'" },
      {
        node: "c",
        at: 4000,
        sql: "insert into item values ('a', 'C', 2, 'C', 0.5, null)",
      },
      {
        node: "b",
        at: 5000,
        sql: "update item set title = 'B', note = 'B' where id = 'a'",
      },
      {
        node: "a",
        at: 6000,
        sql: "update item set score = 9.5 where id = 'b'",
      },
    ],
    expect: "'a'|'B'|2|'B'|0.5|NULL",
  },
  {
    name: "three nodes: a later delete erases the older update but not the newer one",
    ops: [
      {
        node: "b",
        at: 2000,
        sql: "update item set title = 'B' where id = 'a'",
      },
      { node: "c", at: 4500, sql: "update item set note = 'C' where id = 'a'" },
      { node: "a", at: 4000, sql: "delete from item where id = 'a'" },
      {
        node: "a",
        at: 4200,
        sql: "insert into item values ('a', 'A', 1, 'A', null, null)",
      },
    ],
    expect: "'a'|'A'|1|'C'|NULL|NULL",
  },
];

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

for (const c of ROW_CASES) {
  test(`delete and re-insert converge in every order: ${c.name}`, () => {
    const baseRaw = new DatabaseSync(":memory:");
    for (const sql of [ITEM, ...ITEM_BASE]) baseRaw.exec(sql);
    ensureSyncTables(nodeSyncDb(baseRaw), "base");
    const base = baseRaw.serialize();

    const nodes = new Map<
      string,
      { db: SyncDb; clock: Clock; own: IncomingChange[] }
    >();
    const all: IncomingChange[] = [];
    for (const op of [...c.ops].sort((x, y) => x.at - y.at)) {
      let node = nodes.get(op.node);
      if (node === undefined) {
        const db = open(base);
        setState(db, "node", op.node);
        node = { db, clock: openClock(db), own: [] };
        nodes.set(op.node, node);
      }
      const change = computerWrite(node.db, node.clock, {
        side: "c",
        at: op.at,
        sql: [op.sql],
      });
      node.own.push(change);
      all.push(change);
    }
    const replicas: SyncDb[] = [];
    for (const node of nodes.values()) {
      for (const change of all) {
        if (!node.own.includes(change)) apply(node.db, [change]);
      }
      replicas.push(node.db);
    }
    for (const order of permutations(all)) {
      const db = open(base);
      setState(db, "node", "replica");
      for (const change of order) apply(db, [change]);
      replicas.push(db);
    }
    const data = replicas.map(dumpData);
    const clocks = replicas.map(dumpClocks);
    for (let i = 1; i < replicas.length; i++) {
      assert.equal(data[i], data[0], `data of replica ${i}`);
      assert.equal(clocks[i], clocks[0], `clocks of replica ${i}`);
    }
    const rows = data[0]!.split("\n");
    if (c.expect === null)
      assert.ok(!rows.some((r) => r.startsWith("'a'|")), data[0]);
    else assert.ok(rows.includes(c.expect), data[0]);
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

// keep_both 표에서 두 기기가 동시에 같은 텍스트 컬럼을 수정하면 어느 순서(A→B, B→A)로 적용해도
// 승자 row는 원래 PK로 남고 패자 텍스트는 결정론적 dupPk 사본 row로 보존되며, data와 clock이 일치한다.
// 또한 기존 lophn_sync_* 표만 써서 Android C++ authorizer 불변식을 지킨다.
test("keep_both: concurrent text edits converge identically in both orders and only use existing lophn_sync_* tables", () => {
  const ALLOWED_SYNC_TABLES = new Set([
    "lophn_sync_row",
    "lophn_sync_col",
    "lophn_sync_kept",
    "lophn_sync_state",
    "lophn_sync_outbox",
  ]);
  const keepBoth = {
    conflict: (table: string) =>
      table === "memo" ? ("keep_both" as const) : ("lww" as const),
  };

  const baseRaw = new DatabaseSync(":memory:");
  baseRaw.exec(
    "create table memo (id text primary key, title text, body text, pinned integer)",
  );
  const baseDb = nodeSyncDb(baseRaw);
  ensureSyncTables(baseDb, "base");
  const baseClock = openClock(baseDb);
  computerWrite(baseDb, baseClock, {
    side: "c",
    at: 100,
    sql: ["insert into memo values ('m1', 'Notes', 'initial body', 0)"],
  });
  const baseBytes = baseRaw.serialize();

  const makeReplica = (node: string) => {
    const db = open(baseBytes);
    setState(db, "node", node);
    return { db, clock: openClock(db) };
  };

  const a = makeReplica("device-a");
  const b = makeReplica("device-b");
  const editA = computerWrite(a.db, a.clock, {
    side: "c",
    at: 1000,
    sql: ["update memo set body = 'body from A', pinned = 1 where id = 'm1'"],
  });
  const editB = computerWrite(b.db, b.clock, {
    side: "c",
    at: 2000,
    sql: ["update memo set body = 'body from B', pinned = 2 where id = 'm1'"],
  });

  const applyKeepBoth = (db: SyncDb, changes: IncomingChange[]) =>
    inTransaction(db, () => {
      assert.ok(applyRemote(db, changes, openClock(db), keepBoth).ok);
    });

  // A가 B를 받고, B가 A를 받고, 제3의 replica 둘이 반대 순서(A→B, B→A)로 받는다.
  applyKeepBoth(a.db, [editB]);
  applyKeepBoth(b.db, [editA]);
  // 중복 재전달도 멱등해야 한다.
  applyKeepBoth(a.db, [editB]);
  applyKeepBoth(b.db, [editA]);

  const orderAB = makeReplica("replica-ab");
  applyKeepBoth(orderAB.db, [editA, editB]);
  const orderBA = makeReplica("replica-ba");
  applyKeepBoth(orderBA.db, [editB, editA]);

  const replicas = [a.db, b.db, orderAB.db, orderBA.db];
  const data = replicas.map(dumpData);
  const clocks = replicas.map(dumpClocks);
  for (let i = 1; i < replicas.length; i++) {
    assert.equal(data[i], data[0], `keep_both data mismatch on replica ${i}`);
    assert.equal(
      clocks[i],
      clocks[0],
      `keep_both clocks mismatch on replica ${i}`,
    );
  }

  // 정확히 2행: 원본 'm1'에 승자(B) 값, 결정론적 dupPk 사본에 패자(A) 텍스트
  const rows = a.db.all("select id, title, body, pinned from memo order by id");
  assert.equal(rows.length, 2);
  const winner = rows.find((r) => r["id"] === "m1");
  const copy = rows.find((r) => r["id"] !== "m1");
  assert.ok(winner && copy);
  assert.equal(winner["body"], "body from B");
  assert.equal(Number(winner["pinned"]), 2);
  assert.match(String(copy["id"]), /^m1~conflict-[0-9a-f]{12}$/);
  assert.equal(copy["body"], "body from A");
  assert.equal(copy["title"], "Notes");

  // Android C++ authorizer 불변식: 새 lophn_sync_* 표가 생기지 않아야 한다.
  const syncTables = a.db
    .all(
      "select name from sqlite_master where type = 'table' and name like 'lophn_%'",
    )
    .map((r) => String(r["name"]));
  for (const name of syncTables) {
    assert.ok(ALLOWED_SYNC_TABLES.has(name), `unexpected sync table: ${name}`);
  }

  // 사용자가 충돌 사본을 지운 뒤 패자 변경이 다시 와도 되살아나지 않는다.
  const delCopy = computerWrite(a.db, a.clock, {
    side: "c",
    at: 3000,
    sql: [`delete from memo where id = '${String(copy["id"])}'`],
  });
  applyKeepBoth(b.db, [delCopy]);
  applyKeepBoth(a.db, [editA]);
  applyKeepBoth(b.db, [editA]);
  assert.equal(a.db.all("select id from memo").length, 1);
  assert.equal(dumpData(b.db), dumpData(a.db));

  // 순차(인과적) 수정은 충돌 사본을 만들지 않는다.
  const seqB = computerWrite(b.db, b.clock, {
    side: "c",
    at: 4000,
    sql: ["update memo set body = 'body v3 after seeing B' where id = 'm1'"],
  });
  applyKeepBoth(a.db, [seqB]);
  assert.equal(a.db.all("select id from memo").length, 1);
  assert.equal(
    a.db.all("select body from memo where id = 'm1'")[0]!["body"],
    "body v3 after seeing B",
  );

  // 비텍스트(INTEGER) 동시 수정만 있을 때는 LWW로 처리하고 사본을 만들지 않는다.
  const intA = computerWrite(a.db, a.clock, {
    side: "c",
    at: 5000,
    sql: ["update memo set pinned = 10 where id = 'm1'"],
  });
  const intB = computerWrite(b.db, b.clock, {
    side: "c",
    at: 6000,
    sql: ["update memo set pinned = 20 where id = 'm1'"],
  });
  applyKeepBoth(a.db, [intB]);
  applyKeepBoth(b.db, [intA]);
  assert.equal(a.db.all("select id from memo").length, 1);
  assert.equal(dumpData(a.db), dumpData(b.db));
});

test("keep_both: integer, blob, and composite PKs produce schema-safe deterministic conflict copies in both orders", () => {
  const keepBoth = { conflict: () => "keep_both" as const };
  const baseRaw = new DatabaseSync(":memory:");
  baseRaw.exec(
    "create table int_doc (id integer primary key, body text);" +
      "create table blob_doc (id blob primary key, body text);" +
      "create table comp_doc (ns text, seq integer, body text, primary key (ns, seq));",
  );
  const baseDb = nodeSyncDb(baseRaw);
  ensureSyncTables(baseDb, "base");
  computerWrite(baseDb, openClock(baseDb), {
    side: "c",
    at: 100,
    sql: [
      "insert into int_doc values (42, 'base')",
      "insert into blob_doc values (x'cafe', 'base')",
      "insert into comp_doc values ('n1', 7, 'base')",
    ],
  });
  const baseBytes = baseRaw.serialize();

  const makeReplica = (node: string) => {
    const db = open(baseBytes);
    setState(db, "node", node);
    return { db, clock: openClock(db) };
  };
  const a = makeReplica("node-a");
  const b = makeReplica("node-b");

  const editA = computerWrite(a.db, a.clock, {
    side: "c",
    at: 1000,
    sql: [
      "update int_doc set body = 'A' where id = 42",
      "update blob_doc set body = 'A' where id = x'cafe'",
      "update comp_doc set body = 'A' where ns = 'n1' and seq = 7",
    ],
  });
  const editB = computerWrite(b.db, b.clock, {
    side: "c",
    at: 2000,
    sql: [
      "update int_doc set body = 'B' where id = 42",
      "update blob_doc set body = 'B' where id = x'cafe'",
      "update comp_doc set body = 'B' where ns = 'n1' and seq = 7",
    ],
  });

  const ab = makeReplica("ab");
  const ba = makeReplica("ba");
  inTransaction(ab.db, () => {
    assert.ok(applyRemote(ab.db, [editA, editB], ab.clock, keepBoth).ok);
  });
  inTransaction(ba.db, () => {
    assert.ok(applyRemote(ba.db, [editB, editA], ba.clock, keepBoth).ok);
  });

  assert.equal(dumpData(ab.db), dumpData(ba.db));
  assert.equal(dumpClocks(ab.db), dumpClocks(ba.db));
  assert.equal(ab.db.all("select id from int_doc").length, 2);
  assert.equal(ab.db.all("select id from blob_doc").length, 2);
  assert.equal(ab.db.all("select ns from comp_doc").length, 2);
});
