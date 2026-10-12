import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import { defineEvent } from "../../../protocol/server/mod.ts";
import {
  commands,
  deps,
  fileLedger,
  note,
  user,
  wideCase,
} from "./command-harness.ts";
import { defineSyncCommand } from "./handler.ts";
import { recordNote, wideNote } from "./test-commands.ts";
import { openWriter, runCommand } from "./writer.ts";

const fixture = new URL("./writer-fixture.ts", import.meta.url);

Deno.test("platform/ledger#R6: Worker crash는 대기 중인 command를 unavailable로 끝낸다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(
    path,
    new URL("./writer-crash.ts", import.meta.url),
  );
  const pending = writer.command(user(), note("a"));
  const result = await pending;
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "unavailable");
  const again = await writer.command(user(), note("b", "two"));
  assert(!again.ok);
  if (!again.ok) assertEquals(again.error.code, "unavailable");
  await writer.close();
  await writer.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R20: Worker가 줄인 scope는 forbidden이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, fixture);
  const narrowed = user();
  narrowed.scope = { operations: ["CommandResult"], targets: {} };
  const result = await writer.command(narrowed, note("a"));
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "forbidden");
  await writer.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R12: command_results를 흉내 낸 SQL 주석도 변경 행에 센다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  connection.sql.run(
    "create table notes (id integer primary key, name text)",
    [],
  );
  const sneaky = defineSyncCommand(recordNote, (tx, _ctx, input) => {
    for (let i = 0; i < 1001; i += 1) {
      tx.sql.run(
        "insert into notes (name) values (?) -- insert into command_results",
        [input.name],
      );
    }
    return ok({ name: input.name, seq: "0" });
  });
  const result = await runCommand(
    connection,
    deps(),
    [sneaky],
    user(),
    note("a", "sneak"),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "invalid_input");
  const notes = connection.sql.get("select count(*) as n from notes", []);
  assertEquals(notes?.["n"], 0n);
  const exact = defineSyncCommand(recordNote, (tx, _ctx, input) => {
    for (let i = 0; i < 1000; i += 1) {
      tx.sql.run("insert into notes (name) values (?)", [input.name]);
    }
    return ok({ name: input.name, seq: "0" });
  });
  const kept = await runCommand(
    connection,
    deps(),
    [exact],
    user(),
    note("b", "exact"),
  );
  assert(kept.ok);
  const counted = connection.sql.get("select count(*) as n from notes", []);
  assertEquals(counted?.["n"], 1000n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R3: 제출 ctx를 믿지 않고 current 자격을 한 번만 부르며 Tx·handler가 같은 run을 본다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const bound = deps();
  let checkCalls = 0;
  bound.checkCredential = (ctx) => {
    checkCalls += 1;
    return ok({
      ...ctx,
      actor: "user:current",
      conditions: { run: "run-current" },
    });
  };
  // handler가 current run을 그대로 보는지 확인한다. 제출 ctx의 actor·run은 쓰지 않는다.
  const captured = defineEvent("CaptureAttempted", {
    subject: z.string(),
    payload: z.strictObject({ run: z.string().nullable() }),
  });
  const captureRun = defineSyncCommand(
    recordNote,
    (tx, ctx, input, _compare) => {
      tx.emit(captured, `note:${input.name}`, { run: ctx.run ?? null });
      return ok({ name: ctx.run ?? "none", seq: tx.now() });
    },
  );
  const wrote = await runCommand(
    connection,
    bound,
    [captureRun],
    user(),
    note("a"),
  );
  assert(wrote.ok);
  // submitted ctx는 run이 없다. current credential의 묶인 run이 Tx·handler 양쪪에 그대로 간다(R3, R11).
  assertEquals(checkCalls, 1);
  if (wrote.ok) {
    const body = wrote.value.result as { name: string };
    assertEquals(body.name, "run-current");
  }
  const event = connection.sql.get("select actor, run from events", []);
  assertEquals(event?.["actor"], "user:current");
  assertEquals(event?.["run"], "run-current");
  // envelope.run과 current conditions.run이 다르면 scope.targets.run 유무와 무관하게 forbidden이다.
  const mismatchedNoTarget = await runCommand(
    connection,
    bound,
    commands,
    user(),
    {
      ...note("b", "run-no-target"),
      run: "run-other",
    },
  );
  assert(!mismatchedNoTarget.ok);
  if (!mismatchedNoTarget.ok) {
    assertEquals(mismatchedNoTarget.error.code, "forbidden");
  }
  const withRunTarget = user();
  withRunTarget.scope = {
    operations: withRunTarget.scope.operations,
    targets: { run: "run-current" },
  };
  const mismatchedWithTarget = await runCommand(
    connection,
    bound,
    commands,
    withRunTarget,
    { ...note("c", "run-with-target"), run: "run-other" },
  );
  assert(!mismatchedWithTarget.ok);
  if (!mismatchedWithTarget.ok) {
    assertEquals(mismatchedWithTarget.error.code, "forbidden");
  }
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R6: rollback 실패는 연결을 닫고 다음 command를 unavailable로 둔다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const original = connection.exec.bind(connection);
  connection.exec = (sql: string) => {
    if (sql.trim().toLowerCase() === "rollback") {
      throw new Error("rollback exploded");
    }
    original(sql);
  };
  const bad = defineSyncCommand(
    recordNote,
    () => err({ code: "conflict", message: "거절" }),
  );
  const failed = await runCommand(connection, deps(), [bad], user(), note("a"));
  assert(!failed.ok);
  if (!failed.ok) assertEquals(failed.error.code, "unavailable");
  const next = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("b", "next"),
  );
  assert(!next.ok);
  if (!next.ok) assertEquals(next.error.code, "unavailable");
  await Deno.remove(dir, { recursive: true });
});

const badResults: unknown[] = [
  null,
  { ok: "no" },
  { ok: true },
  { ok: false, error: { code: "nope", message: "x" } },
  { ok: false, error: { code: "conflict", message: () => "x" } },
  { ok: true, value: { name: "a", seq: 1n } },
];

Deno.test("platform/ledger#R4: handler의 잘못된 결과는 internal이고 다음 command는 된다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  for (const [index, handled] of badResults.entries()) {
    const bad = defineSyncCommand(recordNote, () => handled as never);
    const result = await runCommand(
      connection,
      deps(),
      [bad],
      user(),
      note("a", `bad-${index}`),
    );
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "internal");
  }
  const next = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("kept", "after"),
  );
  assert(next.ok);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

// 미리 .catch로 잡지 않은 fresh Promise.reject가 handler.ts wrapper를 거쳐도 internal로 관측된다.
// 사전에 .catch한 promise는 product 코드의 관측을 증명하지 못한다(실제 blocker).
Deno.test("platform/ledger#R4: wrapper를 지나는 fresh rejecting Promise는 미리 잡지 않아도 internal이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const wrapped = defineSyncCommand(
    recordNote,
    () => Promise.reject(new Error("fresh async")) as never,
  );
  const result = await runCommand(
    connection,
    deps(),
    [wrapped],
    user(),
    note("a", "fresh-wrapped"),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "internal");
  const next = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("kept", "after-fresh-wrapped"),
  );
  assert(next.ok);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

// defineSyncCommand 없이 직접 정의한 handler의 fresh rejecting Promise도 같다(handler.ts 우회).
Deno.test("platform/ledger#R4: wrapper 없는 직접 정의 handler의 fresh rejecting Promise도 internal이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const direct = {
    route: recordNote,
    handle: () => Promise.reject(new Error("fresh async direct")),
  };
  const result = await runCommand(
    connection,
    deps(),
    [direct as never],
    user(),
    note("a", "fresh-direct"),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "internal");
  const events = connection.sql.get("select count(*) as n from events", []);
  assertEquals(events?.["n"], 0n);
  const next = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("kept", "after-fresh-direct"),
  );
  assert(next.ok);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

// z.unknown() output field라야 schema가 먼저 거절하지 않고 JSON 경계(jsonSafe)가 실제로 거절한다.
// strict output에 extra를 넣으면 schema 거절이 먼저 일어나 이 경계를 증명하지 못한다(실제 blocker).
const wideJsonUnsafe: Array<{ label: string; extra: unknown }> = [
  { label: "function", extra: () => "x" },
  { label: "symbol", extra: Symbol("wide") },
  { label: "bigint", extra: 1n },
];

Deno.test("platform/ledger#R4: z.unknown() output의 함수·symbol·bigint는 internal+rollback이고 다음 command는 된다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  for (const [index, { extra }] of wideJsonUnsafe.entries()) {
    const wide = defineSyncCommand(
      wideNote,
      (_tx, _ctx, input) => ok({ name: input.name, seq: "0", extra }),
    );
    const result = await runCommand(
      connection,
      deps(),
      [wide],
      user(),
      wideCase("a", `wide-${index}`),
    );
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "internal");
  }
  const events = connection.sql.get("select count(*) as n from events", []);
  assertEquals(events?.["n"], 0n);
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  const cyclic = defineSyncCommand(
    wideNote,
    (_tx, _ctx, input) => ok({ name: input.name, seq: "0", extra: cycle }),
  );
  const cycled = await runCommand(
    connection,
    deps(),
    [cyclic],
    user(),
    wideCase("a", "wide-cycle"),
  );
  assert(!cycled.ok);
  if (!cycled.ok) assertEquals(cycled.error.code, "internal");
  const next = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("kept", "after-wide"),
  );
  assert(next.ok);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

// failure details의 함수 값도 조용히 빠지지 않는다. 원래 conflict가 아니라 internal이고 rollback이다(실제 blocker).
Deno.test("platform/ledger#R4: failure details의 함수는 conflict를 그대로 숨기지 않고 internal이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const badDetails = defineSyncCommand(
    recordNote,
    () =>
      err({
        code: "conflict",
        message: "거절",
        details: { fn: (() => "leak") as never },
      }),
  );
  const result = await runCommand(
    connection,
    deps(),
    [badDetails],
    user(),
    note("a", "bad-details"),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "internal");
  const next = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("kept", "after-bad-details"),
  );
  assert(next.ok);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});
