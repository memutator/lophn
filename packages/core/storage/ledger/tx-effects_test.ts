import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { ok } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { defineEvent } from "../../../protocol/events/mod.ts";
import { deps, fileLedger, note, user } from "./command-harness.ts";
import { defineSyncCommand } from "./handler.ts";
import type { LedgerConnection } from "./sqlite.ts";
import { recordNote } from "./test-commands.ts";
import { runCommand } from "./writer.ts";

const counted = defineEvent("NoteCreated", {
  subject: z.string(),
  payload: z.strictObject({ name: z.string() }),
});

async function effectLedger() {
  const dir = await Deno.makeTempDir({ prefix: "lophn-effects-" });
  const { connection } = await fileLedger(dir);
  connection.sql.run("create table probe (x integer)", []);
  connection.sql.run("create table probe_log (x integer)", []);
  return { dir, connection };
}

function count(connection: LedgerConnection, table: string): unknown {
  return connection.sql.get(`select count(*) as n from ${table}`, [])?.["n"];
}

function emitMany(tx: Tx, times: number) {
  for (let i = 0; i < times; i += 1) {
    tx.emit(counted, `note:${i}`, { name: `n${i}` });
  }
}

function advanceMany(tx: Tx, times: number) {
  for (let i = 1; i <= times; i += 1) {
    const moved = tx.advanceSubscriberCursor("limit", String(i));
    if (!moved.ok) throw new Error("cursor");
  }
}

// handler가 거절 throw를 삼키고 ok를 돌려준다. 그래도 commit하면 안 된다.
function swallowing(body: (tx: Tx) => void) {
  return defineSyncCommand(recordNote, (tx, _ctx, input) => {
    try {
      body(tx);
    } catch {
      // 일부러 삼킨다.
    }
    return ok({ name: input.name, seq: "0" });
  });
}

async function expectOverLimit(
  connection: LedgerConnection,
  body: (tx: Tx) => void,
  key: string,
) {
  const result = await runCommand(
    connection,
    deps(),
    [swallowing(body)],
    user(),
    note("a", key),
  );
  assert(!result.ok, key);
  if (!result.ok) assertEquals(result.error.code, "invalid_input", key);
  for (
    const table of [
      "events",
      "subscriber_cursors",
      "probe",
      "probe_log",
      "command_results",
    ]
  ) {
    assertEquals(count(connection, table), 0n, `${key} ${table}`);
  }
}

Deno.test("platform/ledger#R12: tx.emit event 행도 변경 행에 세어 1,000개는 되고 1,001개는 삼켜도 rollback한다", async () => {
  const { dir, connection } = await effectLedger();
  await expectOverLimit(connection, (tx) => emitMany(tx, 1001), "emit-1001");
  // domain 행 999개와 event 2개를 합쳐도 넘친다.
  await expectOverLimit(
    connection,
    (tx) => {
      tx.sql.run(
        "with recursive n(x) as (values (1) union all select x+1 from n where x<999) insert into probe select x from n",
        [],
      );
      emitMany(tx, 2);
    },
    "mixed-1001",
  );
  const exact = await runCommand(
    connection,
    deps(),
    [swallowing((tx) => emitMany(tx, 1000))],
    user(),
    note("a", "emit-1000"),
  );
  assert(exact.ok);
  if (exact.ok) assertEquals(exact.value.wake, true);
  assertEquals(count(connection, "events"), 1000n);
  assertEquals(count(connection, "command_results"), 1n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R12: advanceSubscriberCursor를 반복한 cursor 변경도 한도에 들어 삼켜도 rollback한다", async () => {
  const { dir, connection } = await effectLedger();
  await expectOverLimit(
    connection,
    (tx) => advanceMany(tx, 1001),
    "cursor-1001",
  );
  const exact = await runCommand(
    connection,
    deps(),
    [swallowing((tx) => advanceMany(tx, 1000))],
    user(),
    note("a", "cursor-1000"),
  );
  assert(exact.ok);
  const cursor = connection.sql.get(
    "select processed_through_seq as n from subscriber_cursors",
    [],
  );
  assertEquals(cursor?.["n"], 1000n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R12: events·subscriber_cursors trigger가 만든 행도 한도에 든다", async () => {
  const { dir, connection } = await effectLedger();
  connection.exec(
    "create trigger events_logged after insert on events begin insert into probe_log values (new.seq); end",
  );
  await expectOverLimit(connection, (tx) => emitMany(tx, 501), "emit-trigger");
  connection.exec("drop trigger events_logged");
  connection.exec(
    "create trigger cursor_logged after insert on subscriber_cursors begin insert into probe_log values (1); end",
  );
  connection.exec(
    "create trigger cursor_moved after update on subscriber_cursors begin insert into probe_log values (2); end",
  );
  await expectOverLimit(
    connection,
    (tx) => advanceMany(tx, 501),
    "cursor-trigger",
  );
  connection.close();
  await Deno.remove(dir, { recursive: true });
});
