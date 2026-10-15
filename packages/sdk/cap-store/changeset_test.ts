import { assertEquals, assertRejects } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { MIGRATION_PRIMARY_KEY_REQUIRED } from "../../protocol/apps/activation/migration.ts";
import { hooks } from "./connection.ts";
import { CapabilityError } from "./errors.ts";
import { openStore, type Store } from "./store.ts";

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

function titles(db: DatabaseSync): string[] {
  return db.prepare("select title from todo order by id").all().map((row) =>
    String(row["title"])
  );
}

Deno.test("write 동안의 변경이 changeset으로 나오고 lophn_data_schema 표의 변경은 빠진다", async () => {
  await withStore(TODO_STEP, (store) => {
    assertEquals(hooks.endChangeset(), null);
    hooks.beginChangeset();
    store.db.exec("insert into todo (title) values ('milk')");
    store.db.exec("update lophn_data_schema set applied_at = 'changed'");
    const changeset = hooks.endChangeset();
    assertEquals(changeset !== null, true);

    const other = new DatabaseSync(":memory:");
    other.exec(TODO);
    other.exec(
      "create table lophn_data_schema (id integer primary key, applied_at text)",
    );
    other.exec("insert into lophn_data_schema values (1, 'before')");
    assertEquals(other.applyChangeset(changeset!), true);
    assertEquals(titles(other), ["milk"]);
    assertEquals(
      other.prepare("select applied_at from lophn_data_schema").get()![
        "applied_at"
      ],
      "before",
    );
    other.close();
    // 변경이 없으면 null이고 session은 닫혀 있다.
    assertEquals(hooks.endChangeset(), null);
  });
});

Deno.test("여러 changeset 가운데 하나라도 충돌하면 하나도 적용하지 않고 DB가 그대로다", async () => {
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
    assertEquals(hooks.applyChangesets([insert, stale]).ok, false);
    assertEquals(titles(store.db), ["a"]);
    assertEquals(hooks.applyChangesets([insert]).ok, true);
    assertEquals(titles(store.db), ["a", "b"]);
  });
});

Deno.test("PRIMARY KEY 없는 표를 만드는 migration은 실패하고 그 단계는 rollback된다", async () => {
  const store = openStore({ path: ":memory:" });
  try {
    const error = await assertRejects(
      () =>
        store.migrate([{
          from: 0,
          to: 1,
          sql:
            "create table ok (id integer primary key); create table loose (x text)",
          loss: [],
        }]),
      CapabilityError,
    );
    assertEquals(error.code, "invalid_input");
    assertEquals(
      error.message.startsWith(MIGRATION_PRIMARY_KEY_REQUIRED),
      true,
    );
    assertEquals(store.schema(), 0);
    assertEquals(
      store.db.prepare("select name from sqlite_master where name = 'ok'")
        .get(),
      undefined,
    );
  } finally {
    store.close();
  }
});
