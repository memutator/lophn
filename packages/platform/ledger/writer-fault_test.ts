import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { defineCommand, definePort } from "../../contracts/platform/mod.ts";
import {
  commands,
  deps,
  fileLedger,
  machine,
  note,
  user,
} from "./command-harness.ts";
import { defineSyncCommand } from "./handler.ts";
import { recordNote } from "./test-commands.ts";
import { openWriter, runCommand } from "./writer.ts";
import { resetCredentialMirror, revokeCredential } from "./writer-fixture.ts";

const fixture = new URL("./writer-fixture.ts", import.meta.url);
const closedEntry = new URL("./writer-main.ts", import.meta.url);

Deno.test("platform/ledger#R6: commit 저장 오류는 unavailable이고 재시도는 새 확정이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const original = connection.exec.bind(connection);
  let commits = 0;
  connection.exec = (sql: string) => {
    if (sql.trim().toLowerCase() === "commit") {
      commits += 1;
      if (commits === 1) {
        throw new Error("database or disk is full");
      }
    }
    original(sql);
  };
  const failed = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("a"),
  );
  assert(!failed.ok);
  if (!failed.ok) assertEquals(failed.error.code, "unavailable");
  const events = connection.sql.get("select count(*) as n from events", []);
  const results = connection.sql.get(
    "select count(*) as n from command_results",
    [],
  );
  assertEquals(events?.["n"], 0n);
  assertEquals(results?.["n"], 0n);
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

Deno.test("platform/ledger#R12: handler SQL 변경 행 1,000개를 넘으면 전체가 rollback된다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  connection.sql.run(
    "create table notes (id integer primary key, name text)",
    [],
  );
  const bulk = defineSyncCommand(recordNote, (tx, _ctx, input) => {
    for (let i = 0; i < 1001; i += 1) {
      tx.sql.run("insert into notes (name) values (?)", [input.name]);
    }
    return ok({ name: input.name, seq: "0" });
  });
  const result = await runCommand(
    connection,
    deps(),
    [bulk],
    user(),
    note("bulk", "rows"),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "invalid_input");
  const notes = connection.sql.get("select count(*) as n from notes", []);
  const events = connection.sql.get("select count(*) as n from events", []);
  assertEquals(notes?.["n"], 0n);
  assertEquals(events?.["n"], 0n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R4: 동기 wrapper 없는 Promise handler는 rollback된다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const asyncHandler = {
    route: recordNote,
    handle: () => Promise.resolve(ok({ name: "a", seq: "0" })),
  };
  const result = await runCommand(
    connection,
    deps(),
    [asyncHandler as never],
    user(),
    note("a"),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "internal");
  const events = connection.sql.get("select count(*) as n from events", []);
  assertEquals(events?.["n"], 0n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R3: handler 결과가 output schema 밖이면 internal이고 기록이 없다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const bad = defineSyncCommand(recordNote, () => ok({ name: 1 } as never));
  const result = await runCommand(connection, deps(), [bad], user(), note("a"));
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "internal");
  const stored = connection.sql.get(
    "select count(*) as n from command_results",
    [],
  );
  assertEquals(stored?.["n"], 0n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R20: machine task 조건은 scope에 있을 때만 검사한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const actor = {
    ...machine(),
    scope: {
      operations: ["AdvanceSubscriberCursor"],
      targets: { task: "cursor" },
    },
    conditions: { task: "cursor" },
  };
  const up = await runCommand(connection, deps(), commands, actor, {
    command: "AdvanceSubscriberCursor",
    input: { subscriber: "notifications", scanned_through_seq: "1" },
    idempotency_key: "cur-task",
    compare: { processed_through_seq: "0" },
    prepared: [],
  });
  assert(up.ok);
  const wrong = await runCommand(connection, deps(), commands, {
    ...actor,
    conditions: { task: "other" },
  }, {
    command: "AdvanceSubscriberCursor",
    input: { subscriber: "notifications", scanned_through_seq: "2" },
    idempotency_key: "cur-task-2",
    compare: { processed_through_seq: "1" },
    prepared: [],
  });
  assert(!wrong.ok);
  if (!wrong.ok) assertEquals(wrong.error.code, "forbidden");
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R3: confirmation command는 확인 조립 전에 unavailable이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const confirmed = defineCommand({
    resource: "notes",
    method: "confirm",
    name: "ConfirmNote",
    input: z.strictObject({ name: z.string() }),
    output: z.strictObject({ name: z.string() }),
    compare: z.strictObject({}),
    actors: ["user"],
    errors: ["unavailable"],
    confirmation: "required",
    binding: ["name"],
  });
  const handler = defineSyncCommand(
    confirmed,
    (_tx, _ctx, input) => ok({ name: input.name }),
  );
  const actor = user();
  actor.scope = { operations: ["ConfirmNote"], targets: {} };
  const result = await runCommand(connection, deps(), [handler], actor, {
    command: "ConfirmNote",
    input: { name: "a" },
    idempotency_key: "confirm",
    compare: {},
    prepared: [],
  });
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "unavailable");
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R3: writer Worker는 command를 순서대로 끝내고 close를 그 뒤에 한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, fixture);
  const first = writer.command(user(), note("a", "one"));
  const second = writer.command(user(), note("b", "two"));
  const closed = writer.close();
  const after = writer.command(user(), note("c", "three"));
  const [left, right, late] = await Promise.all([first, second, after]);
  await closed;
  assert(left.ok);
  assert(right.ok);
  if (left.ok) assertEquals(left.value.first_seq, "1");
  if (right.ok) assertEquals(right.value.first_seq, "2");
  assert(!late.ok);
  if (!late.ok) assertEquals(late.error.code, "unavailable");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R13: writer 회수 뒤 replay는 unauthorized다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, fixture);
  const wrote = await writer.command(user(), note("a"));
  assert(wrote.ok);
  revokeCredential(path, "cred-1");
  const replayed = await writer.command(user(), note("a"));
  assert(!replayed.ok);
  if (!replayed.ok) assertEquals(replayed.error.code, "unauthorized");
  await writer.close();
  resetCredentialMirror(path);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R3: tx.newId와 tx.port는 등록한 source·port를 쓴다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const port = definePort<{ mark: string }>("note");
  const bound = deps();
  bound.ports = new Map([[port, { mark: "fixed" }]]);
  const handler = defineSyncCommand(recordNote, (tx) => {
    return ok({ name: tx.newId("doc"), seq: tx.port(port).mark });
  });
  const result = await runCommand(
    connection,
    bound,
    [handler],
    user(),
    note("a"),
  );
  assert(result.ok);
  if (result.ok) {
    const body = result.value.result as { name: string; seq: string };
    assert(body.name.startsWith("doc_"));
    assertEquals(body.seq, "fixed");
  }
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R6: 권한 없는 기본 writer entry는 command를 unavailable로 거절한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, closedEntry);
  const result = await writer.command(user(), note("a"));
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "unavailable");
  await writer.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R3: rollback으로 빈 seq가 있으면 first_seq는 실제 event다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  connection.exec(
    "insert into sqlite_sequence (name, seq) values ('events', 1)",
  );
  const result = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("kept"),
  );
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.first_seq, "2");
    assertEquals(result.value.replayed, false);
  }
  connection.close();
  await Deno.remove(dir, { recursive: true });
});
