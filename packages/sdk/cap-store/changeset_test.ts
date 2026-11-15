import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MIGRATION_PRIMARY_KEY_REQUIRED } from "../../protocol/apps/activation/migration-sql.ts";
import { hooks } from "./connection.node.ts";
import type { StoreDb } from "./db.ts";
import { CapabilityError } from "./errors.ts";
import type { Store } from "./store.ts";
import { openStore } from "./store.node.ts";

const TODO = "create table todo (id integer primary key, title text not null)";

async function withStore(
  steps: Parameters<Store["migrate"]>[0],
  run: (store: Store) => Promise<void> | void,
): Promise<void> {
  const store = openStore({ path: ":memory:" });
  try {
    await store.migrate(steps);
    await run(store);
  } finally {
    store.close();
  }
}

const TODO_STEP = [{ from: 0, to: 1, sql: TODO, loss: [] }];

// 같은 schema의 따로 만든 DB에서 SQL이 만드는 changeset을 뜬다.
function changesetOf(seed: string, change: string): Uint8Array {
  const scratch = new DatabaseSync(":memory:");
  scratch.exec(`${TODO}; ${seed}`);
  const session = scratch.createSession();
  scratch.exec(change);
  const changeset = session.changeset();
  session.close();
  scratch.close();
  return changeset;
}

function titles(db: StoreDb): string[] {
  return db
    .prepare("select title from todo order by id")
    .all()
    .map((row) => String(row["title"]));
}

test("write 동안의 변경이 changeset으로 나오고 lophn_data_schema 표의 변경은 빠진다", async () => {
  await withStore(TODO_STEP, (store) => {
    assert.deepStrictEqual(hooks.endChangeset(), null);
    hooks.beginChangeset();
    store.db.exec("insert into todo (title) values ('milk')");
    store.db.exec("update lophn_data_schema set applied_at = 'changed'");
    const changeset = hooks.endChangeset();
    assert.deepStrictEqual(changeset !== null, true);

    const other = new DatabaseSync(":memory:");
    other.exec(TODO);
    other.exec(
      "create table lophn_data_schema (id integer primary key, applied_at text)",
    );
    other.exec("insert into lophn_data_schema values (1, 'before')");
    assert.deepStrictEqual(other.applyChangeset(changeset!), true);
    assert.deepStrictEqual(titles(other), ["milk"]);
    assert.deepStrictEqual(
      other.prepare("select applied_at from lophn_data_schema").get()![
        "applied_at"
      ],
      "before",
    );
    other.close();
    // 변경이 없으면 null이고 session은 닫혀 있다.
    assert.deepStrictEqual(hooks.endChangeset(), null);
  });
});

test("여러 changeset 가운데 하나라도 충돌하면 하나도 적용하지 않고 DB가 그대로다", async () => {
  await withStore(TODO_STEP, (store) => {
    store.db.exec("insert into todo (id, title) values (1, 'a')");
    const insert = changesetOf(
      "insert into todo values (1, 'a')",
      "insert into todo values (2, 'b')",
    );
    const stale = changesetOf(
      "insert into todo values (1, 'x')",
      "update todo set title = 'y' where id = 1",
    );
    assert.deepStrictEqual(hooks.applyChangesets([insert, stale]).ok, false);
    assert.deepStrictEqual(titles(store.db), ["a"]);
    assert.deepStrictEqual(hooks.applyChangesets([insert]).ok, true);
    assert.deepStrictEqual(titles(store.db), ["a", "b"]);
  });
});

test("PRIMARY KEY 없는 표를 만드는 migration은 실패하고 그 단계는 rollback된다", async () => {
  const store = openStore({ path: ":memory:" });
  try {
    // node:assert/strict의 rejects는 오류를 돌려주지 않아 직접 받는다.
    const error = await store
      .migrate([
        {
          from: 0,
          to: 1,
          sql: "create table ok (id integer primary key); create table loose (x text)",
          loss: [],
        },
      ])
      .then(
        () => assert.fail("migrate should reject"),
        (error: unknown) => error,
      );
    assert.ok(error instanceof CapabilityError);
    assert.deepStrictEqual(error.code, "invalid_input");
    assert.deepStrictEqual(
      error.message.startsWith(MIGRATION_PRIMARY_KEY_REQUIRED),
      true,
    );
    assert.deepStrictEqual(store.schema(), 0);
    assert.deepStrictEqual(
      store.db
        .prepare("select name from sqlite_master where name = 'ok'")
        .get(),
      undefined,
    );
  } finally {
    store.close();
  }
});

test("lophn_sync_ 표와 schema 표의 변경은 changeset에 담기지 않는다", async () => {
  await withStore(TODO_STEP, (store) => {
    store.db.exec(
      "create table lophn_sync_clock (id integer primary key, v text)",
    );
    hooks.beginChangeset();
    store.db.exec("insert into todo (title) values ('milk')");
    store.db.exec("insert into lophn_sync_clock values (1, 'tick')");
    const changeset = hooks.endChangeset();

    const other = new DatabaseSync(":memory:");
    other.exec(TODO);
    other.exec(
      "create table lophn_sync_clock (id integer primary key, v text)",
    );
    assert.deepStrictEqual(other.applyChangeset(changeset!), true);
    assert.deepStrictEqual(titles(other), ["milk"]);
    assert.deepStrictEqual(
      other.prepare("select count(*) as n from lophn_sync_clock").get()!["n"],
      0,
    );
    other.close();
  });
});

test("transaction은 바깥 transaction 안에서도 자기 몫만 rollback하고 commit한다", async () => {
  await withStore(TODO_STEP, (store) => {
    const { db } = store;
    db.exec("begin");
    store.transaction(() => db.exec("insert into todo (title) values ('a')"));
    assert.throws(() =>
      store.transaction(() => {
        db.exec("insert into todo (title) values ('b')");
        throw new Error("fail");
      }),
    );
    // 안쪽이 겹쳐도 된다.
    store.transaction(() =>
      store.transaction(() => db.exec("insert into todo (title) values ('c')")),
    );
    db.exec("commit");
    assert.deepStrictEqual(titles(db), ["a", "c"]);

    // 바깥이 rollback하면 안쪽에서 commit한 것도 사라진다.
    db.exec("begin");
    store.transaction(() => db.exec("insert into todo (title) values ('d')"));
    db.exec("rollback");
    assert.deepStrictEqual(titles(db), ["a", "c"]);
  });
});

test("applyChangesets는 바깥 transaction 안에서도 충돌이면 하나도 적용하지 않는다", async () => {
  await withStore(TODO_STEP, (store) => {
    store.db.exec("insert into todo (id, title) values (1, 'a')");
    const insert = changesetOf(
      "insert into todo values (1, 'a')",
      "insert into todo values (2, 'b')",
    );
    const stale = changesetOf(
      "insert into todo values (1, 'x')",
      "update todo set title = 'y' where id = 1",
    );
    store.db.exec("begin");
    assert.deepStrictEqual(hooks.applyChangesets([insert, stale]).ok, false);
    assert.deepStrictEqual(hooks.applyChangesets([insert]).ok, true);
    store.db.exec("commit");
    assert.deepStrictEqual(titles(store.db), ["a", "b"]);
  });
});

test("host가 준 DB로 열고 인자 없는 migrate는 host의 migration을 쓴다", async () => {
  const raw = new DatabaseSync(":memory:");
  const host = (mode: "preview" | "live") => ({
    mode,
    dataPath: "",
    store: {
      recording: () => false,
      open: () => raw,
      migrations: () => ({ target: 1, steps: TODO_STEP }),
    },
  });
  const store = openStore({ host: host("preview") });
  assert.deepStrictEqual(await store.migrate(), 1);
  store.db.prepare("insert into todo (title) values (?)").run("milk");
  assert.deepStrictEqual(titles(raw), ["milk"]);
  // live는 schema가 이미 target이면 아무것도 하지 않는다.
  assert.deepStrictEqual(await openStore({ host: host("live") }).migrate(), 1);
  raw.close();
});
