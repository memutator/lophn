import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  commands,
  deps,
  fileLedger,
  machine,
  note,
  user,
} from "./command-harness.ts";
import { runCommand, runReadResult } from "./writer.ts";

Deno.test("platform/ledger#R6: 잠금 초과는 unavailable이고 입력을 소비하지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { path, connection } = await fileLedger(dir);
  const holder = new DatabaseSync(path);
  holder.exec("begin immediate");
  const started = Date.now();
  const result = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("a"),
  );
  const waited = Date.now() - started;
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "unavailable");
  assert(waited >= 5000);
  holder.exec("rollback");
  holder.close();
  const stored = runReadResult(
    connection,
    deps().checkCredential,
    user(),
    "k1",
  );
  assert(stored.ok);
  if (stored.ok) assertEquals(stored.value, null);
  const retried = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("a"),
  );
  assert(retried.ok);
  if (retried.ok) assertEquals(retried.value.replayed, false);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R20: 등록되지 않은 command 이름·SQL은 실행하지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const unknown = await runCommand(connection, deps(), commands, user(), {
    command: "drop table events",
    input: { sql: "delete from events" },
    idempotency_key: "bad",
    compare: {},
    prepared: ["/etc/passwd"],
  });
  assert(!unknown.ok);
  if (!unknown.ok) assertEquals(unknown.error.code, "invalid_input");
  const events = connection.sql.get(
    "select count(*) as n from sqlite_master where name = 'events'",
    [],
  );
  assertEquals(events?.["n"], 1n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R20: AdvanceSubscriberCursor는 줄어들면 conflict이고 event가 없다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const actor = machine();
  const up = await runCommand(connection, deps(), commands, actor, {
    command: "AdvanceSubscriberCursor",
    input: { subscriber: "notifications", scanned_through_seq: "4" },
    idempotency_key: "cur-1",
    compare: { processed_through_seq: "0" },
    prepared: [],
  });
  assert(up.ok);
  if (up.ok) assertEquals(up.value.wake, false);
  const down = await runCommand(connection, deps(), commands, actor, {
    command: "AdvanceSubscriberCursor",
    input: { subscriber: "notifications", scanned_through_seq: "3" },
    idempotency_key: "cur-2",
    compare: { processed_through_seq: "4" },
    prepared: [],
  });
  assert(!down.ok);
  if (!down.ok) assertEquals(down.error.code, "conflict");
  const events = connection.sql.get("select count(*) as n from events", []);
  assertEquals(events?.["n"], 0n);
  const cursor = connection.sql.get(
    "select processed_through_seq as n from subscriber_cursors",
    [],
  );
  assertEquals(cursor?.["n"], 4n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R13: commands/result는 자기 principal의 결과만 본다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const wrote = await runCommand(
    connection,
    deps(),
    commands,
    user("a"),
    note("a"),
  );
  assert(wrote.ok);
  const check = deps().checkCredential;
  const own = runReadResult(connection, check, user("a"), "k1");
  const other = runReadResult(connection, check, user("b"), "k1");
  assert(own.ok);
  assert(other.ok);
  if (own.ok) assert(own.value !== null);
  if (other.ok) assertEquals(other.value, null);
  const missing = runReadResult(connection, check, user("a"), "missing");
  assert(missing.ok);
  if (missing.ok) assertEquals(missing.value, null);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R13: idempotency key가 비었거나 128 bytes를 넘으면 실행하지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const empty = await runCommand(connection, deps(), commands, user(), {
    ...note("a", ""),
  });
  assert(!empty.ok);
  if (!empty.ok) assertEquals(empty.error.code, "invalid_input");
  const long = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("a", "k".repeat(129)),
  );
  assert(!long.ok);
  if (!long.ok) assertEquals(long.error.code, "invalid_input");
  const events = connection.sql.get("select count(*) as n from events", []);
  assertEquals(events?.["n"], 0n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R6: 닫힌 연결 뒤 read-result는 safe unavailable이고 던지지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const wrote = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("a"),
  );
  assert(wrote.ok);
  connection.close();
  const stored = runReadResult(
    connection,
    deps().checkCredential,
    user(),
    "k1",
  );
  assert(!stored.ok);
  if (!stored.ok) assertEquals(stored.error.code, "unavailable");
  await Deno.remove(dir, { recursive: true });
});

Deno.test(
  "platform/ledger#R6: rollback 실패는 poison 후 다음 BEGIN·read-result를 fail-closed로 둔다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
    const { connection } = await fileLedger(dir);
    const originalExec = connection.exec.bind(connection);
    connection.exec = (sql: string) => {
      if (sql.trim().toLowerCase() === "rollback") {
        throw new Error("native rollback exploded");
      }
      originalExec(sql);
    };
    const rejecting = {
      route: commands[0].route,
      handle: () => ({
        ok: false,
        error: { code: "conflict", message: "거절" },
      }),
    };
    const failed = await runCommand(
      connection,
      deps(),
      [rejecting as never],
      user(),
      note("a", "poison"),
    );
    assert(!failed.ok);
    if (!failed.ok) assertEquals(failed.error.code, "unavailable");
    assert(connection.failed());
    // poison 뒤 raw 원문이 새지 않고 다음 BEGIN도 같은 unavailable이다.
    const nextCommand = await runCommand(
      connection,
      deps(),
      commands,
      user(),
      note("a", "poison-next"),
    );
    assert(!nextCommand.ok);
    if (!nextCommand.ok) assertEquals(nextCommand.error.code, "unavailable");
    const nextRead = runReadResult(
      connection,
      deps().checkCredential,
      user(),
      "poison",
    );
    assert(!nextRead.ok);
    if (!nextRead.ok) assertEquals(nextRead.error.code, "unavailable");
    // poison 후 close는 반복해도 던지지 않는다(idempotent).
    connection.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  },
);
