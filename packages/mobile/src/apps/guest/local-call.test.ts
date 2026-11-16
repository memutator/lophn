import assert from "node:assert/strict";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import type { PhoneStoreDb } from "../../../../protocol/apps/phone-backend-host.ts";
import type { PhoneGuestMessage, PhoneHostMessage } from "../../../../protocol/apps/phone-screen.ts";
import type { GuestAppDb } from "../../../modules/lophn-app-db/index.ts";
import { installBridge } from "../../../guest/bridge.ts";
import { installLocalBackend } from "./local-call.ts";

// The native guest handle (modules/lophn-app-db) on node:sqlite: beginCall is BEGIN IMMEDIATE with a session, endCall
// writes a non-empty changeset to the outbox in the same transaction and commits, abortCall rolls back.
function fakeDb() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`create table item (id text primary key, title text not null);
    create table lophn_sync_outbox (id text primary key, operation text not null, started_at text not null,
      changeset blob not null, hlc integer);`);
  let session: ReturnType<DatabaseSync["createSession"]> | undefined;
  const control = { failEnd: false };
  const statement = (s: StatementSync) => ({
    all: (p: unknown[] = []) => s.all(...(p as never[])),
    get: (p: unknown[] = []) => s.get(...(p as never[])),
    run: (p: unknown[] = []) => {
      const r = s.run(...(p as never[]));
      return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
    },
  });
  const db: GuestAppDb = {
    exec: (text) => sql.exec(text),
    prepare: (text) => statement(sql.prepare(text)),
    beginCall() {
      sql.exec("begin immediate");
      session = sql.createSession({ table: "item" });
    },
    endCall({ id, operation, started_at }) {
      const changeset = session?.changeset() ?? new Uint8Array();
      session?.close();
      if (control.failEnd) {
        sql.exec("rollback");
        throw new Error("disk I/O error");
      }
      if (changeset.length > 0) {
        sql
          .prepare("insert into lophn_sync_outbox (id, operation, started_at, changeset) values (?, ?, ?, ?)")
          .run(id, operation, started_at, changeset);
      }
      sql.exec("commit");
      return { bytes: changeset.length };
    },
    abortCall() {
      if (sql.isTransaction) sql.exec("rollback");
    },
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  };
  return { db, sql, control };
}

test("local 호출 하나는 transaction 하나다: write와 outbox 줄은 같이 commit되고, 던진 handler의 변경도 남고, endCall이 실패하면 아무것도 남지 않으며, read·write는 host로 가지 않고 external만 간다", async () => {
  const posted: PhoneGuestMessage[] = [];
  let deliver: (message: PhoneHostMessage) => void = () => {};
  Object.assign(globalThis, {
    postMessage: (message: PhoneGuestMessage) => posted.push(message),
    setOnMessage: (listener: typeof deliver) => {
      deliver = listener;
    },
  });
  const bridge = installBridge();
  const { db, sql, control } = fakeDb();
  installLocalBackend(globalThis, db, bridge, 50);

  // What backend.js does through @lophn/cap-tool and @lophn/cap-store's phone entries.
  const g = globalThis as unknown as Record<symbol, any>;
  const store = (): PhoneStoreDb => g[Symbol.for("lophn.cap-host")].store.open();
  const register = (name: string, handle: (input: any) => unknown) =>
    g[Symbol.for("lophn.cap-tool")].register({ name, handle });
  const insert = (id: string) => store().prepare("insert into item (id, title) values (?, ?)").run(id, id);
  register("add", (input) => (insert(input.id), { id: input.id }));
  register("list", () => store().prepare("select id from item order by id").all());
  register("refuse", (input) => {
    insert(input.id);
    throw Object.assign(new Error("already full"), { [Symbol.for("lophn.app-tool-rejection")]: "conflict" });
  });
  register("slow", async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    insert(input.id);
  });
  register("send", () => "never runs here");

  const app = (globalThis as unknown as { lophnApp: { callOperation(n: string, i: unknown): Promise<unknown> } })
    .lophnApp;
  const outbox = () => sql.prepare("select id, operation from lophn_sync_outbox order by rowid").all();
  const items = () => sql.prepare("select id from item order by id").all().map((row) => row["id"]);
  deliver({
    type: "init",
    place: { place: "phone", params: {}, workspace: null },
    scheme: "light",
    locale: "en",
    local: {
      operations: { add: "write", list: "read", refuse: "write", slow: "write", send: "external" },
      data_schema: 1,
    },
  });

  // two at once: one transaction at a time (a nested BEGIN would throw)
  assert.deepEqual(
    await Promise.all([app.callOperation("add", { id: "a" }), app.callOperation("add", { id: "b" })]),
    [{ id: "a" }, { id: "b" }],
  );
  assert.deepEqual(await app.callOperation("list", null), [{ id: "a" }, { id: "b" }]);
  assert.deepEqual(
    outbox().map((row) => row["operation"]),
    ["add", "add"],
  );
  assert.match(String(outbox()[0]?.["id"]), /^[0-9a-hjkmnp-tv-z]{26}$/);
  assert.deepEqual(posted, [{ type: "local_change" }, { type: "local_change" }]);

  await assert.rejects(app.callOperation("refuse", { id: "c" }), { message: "conflict: already full" });
  assert.deepEqual(items(), ["a", "b", "c"]);
  assert.equal(outbox().length, 3);

  control.failEnd = true;
  await assert.rejects(app.callOperation("add", { id: "d" }), { message: "internal: disk I/O error" });
  control.failEnd = false;
  assert.deepEqual(items(), ["a", "b", "c"]);
  assert.equal(outbox().length, 3);

  // over the limit: rolled back, and the late write does not land in the next call
  await assert.rejects(app.callOperation("slow", { id: "e" }), /^Error: unavailable: slow did not finish/);
  assert.deepEqual(await app.callOperation("add", { id: "f" }), { id: "f" });
  assert.deepEqual(items(), ["a", "b", "c", "f"]);
  assert.equal(sql.isTransaction, false);

  posted.length = 0;
  const sent = app.callOperation("send", { to: "x" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(posted, [{ type: "call", id: 1, operation: "send", input: { to: "x" } }]);
  deliver({ type: "reply", id: 1, outcome: { ok: true, value: "sent by the computer" } });
  assert.equal(await sent, "sent by the computer");
});
