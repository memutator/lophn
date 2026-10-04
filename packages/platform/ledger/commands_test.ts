import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { err, manualClock, ok } from "../../base/mod.ts";
import { defineCommand } from "../../contracts/platform/mod.ts";
import { canonicalFingerprintBody, COMMAND_MAX_CAS } from "./fingerprint.ts";
import { defineSyncCommand } from "./handler.ts";
import { recordNoteCommand } from "./test-commands.ts";
import { runCommand, runReadResult } from "./writer.ts";
import {
  commands,
  deps,
  fileLedger,
  note,
  NOW,
  START,
  user,
} from "./command-harness.ts";

Deno.test("platform/ledger#R13: 지문은 RFC 8785이고 token·handle 원문을 빼며 결정 내용은 넣는다", () => {
  const left = canonicalFingerprintBody({
    command: "RecordNote",
    input: { name: "a", z: 1 },
    compare: { b: "2", a: "1" },
    run: null,
    prepared: ["blob-1"],
    decision: { target: "doc:1", content: "keep" },
  });
  const right = canonicalFingerprintBody({
    command: "RecordNote",
    input: { z: 1, name: "a" },
    compare: { a: "1", b: "2" },
    run: null,
    prepared: ["blob-1"],
    decision: { content: "keep", target: "doc:1" },
  });
  assertEquals(left, right);
  assert(!left.includes("handle"));
  assert(left.includes("keep"));
  assert(left.indexOf('"a"') < left.indexOf('"b"'));
});

Deno.test("platform/ledger#R4: await를 돌려주는 handler는 실행에서 거절한다", () => {
  const route = defineCommand({
    resource: "notes",
    method: "sync",
    name: "SyncNote",
    input: z.strictObject({}),
    output: z.strictObject({}),
    compare: z.strictObject({}),
    actors: ["user"],
    errors: ["invalid_input"],
  });
  const sync = defineSyncCommand(route, () => ok({}));
  assertEquals(sync.handle({} as never, user(), {}, {}).ok, true);
  const waiting = defineSyncCommand(
    route,
    (() => Promise.resolve(ok({}))) as never,
  );
  let threw = false;
  try {
    waiting.handle({} as never, user(), {}, {});
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("platform/ledger#R3: command는 event와 결과를 한 transaction에 남기고 commit 뒤에 wake한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const result = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("a"),
  );
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.replayed, false);
    assertEquals(result.value.wake, true);
    assertEquals(result.value.first_seq, "1");
    assertEquals(result.value.last_seq, "1");
  }
  const stored = runReadResult(
    connection,
    deps().checkCredential,
    user(),
    "k1",
  );
  assert(stored.ok);
  if (stored.ok && stored.value) assertEquals(stored.value.first_seq, "1");
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R5: handler가 거절하면 결과도 event도 없고 wake도 없다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const failing = defineSyncCommand(
    recordNoteCommand.route,
    () => err({ code: "conflict", message: "거절" }),
  );
  const result = await runCommand(
    connection,
    deps(),
    [failing],
    user(),
    note("a"),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "conflict");
  const events = connection.sql.get("select count(*) as n from events", []);
  const results = connection.sql.get(
    "select count(*) as n from command_results",
    [],
  );
  assertEquals(events?.["n"], 0n);
  assertEquals(results?.["n"], 0n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R13: 같은 key·같은 입력은 replayed이고 다른 입력은 conflict다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const clock = manualClock(START);
  const bound = deps(clock);
  const first = await runCommand(
    connection,
    bound,
    commands,
    user(),
    note("a"),
  );
  assert(first.ok);
  clock.advance(60_000);
  const again = await runCommand(
    connection,
    bound,
    commands,
    {
      ...user(),
      credential_ref: "rotated",
      expires_at: "2026-01-01T00:02:00.000Z",
    },
    note("a"),
  );
  assert(again.ok);
  if (again.ok) {
    assertEquals(again.value.replayed, true);
    assertEquals(again.value.wake, false);
  }
  const events = connection.sql.get("select count(*) as n from events", []);
  assertEquals(events?.["n"], 1n);
  const other = await runCommand(
    connection,
    bound,
    commands,
    user(),
    note("b"),
  );
  assert(!other.ok);
  if (!other.ok) assertEquals(other.error.code, "conflict");
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R13: 만료된 자격의 재전달은 저장 결과를 돌려주지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const clock = manualClock(START);
  const bound = deps(clock);
  const first = await runCommand(
    connection,
    bound,
    commands,
    user(),
    note("a"),
  );
  assert(first.ok);
  clock.advance(1_000);
  const expired = await runCommand(
    connection,
    bound,
    commands,
    { ...user(), expires_at: NOW },
    note("a"),
  );
  assert(!expired.ok);
  if (!expired.ok) assertEquals(expired.error.code, "unauthorized");
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R12: CAS 하나라도 다르면 변경이 없다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const mismatched = defineSyncCommand(
    recordNoteCommand.route,
    (_tx, _ctx, input, compare) => {
      const fields = compare !== null && typeof compare === "object"
        ? compare as Record<string, unknown>
        : {};
      if (fields["name_hash"] !== undefined && fields["name_hash"] !== "aa") {
        return err({
          code: "conflict",
          message: "CAS 기준이 현재 기록과 다르다",
        });
      }
      if (fields["seen_seq"] !== undefined && fields["seen_seq"] !== "0") {
        return err({
          code: "conflict",
          message: "CAS 기준이 현재 기록과 다르다",
        });
      }
      return ok({ name: input.name, seq: "0" });
    },
  );
  const result = await runCommand(
    connection,
    deps(),
    [mismatched],
    user(),
    note("a", "k", { name_hash: "aa", seen_seq: "9" }),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "conflict");
  const events = connection.sql.get("select count(*) as n from events", []);
  assertEquals(events?.["n"], 0n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R12: CAS leaf 256개를 넘으면 handler 전에 거절한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  let called = 0;
  const watching = defineSyncCommand(
    recordNoteCommand.route,
    (_tx, _ctx, input) => {
      called += 1;
      return ok({ name: input.name, seq: "0" });
    },
  );
  const nested = {
    items: Array.from({ length: COMMAND_MAX_CAS + 1 }, () => "x"),
  };
  const tooManyCas = await runCommand(connection, deps(), [watching], user(), {
    command: "RecordNote",
    input: { name: "a" },
    idempotency_key: "cas",
    compare: nested,
    prepared: [],
  });
  assert(!tooManyCas.ok);
  if (!tooManyCas.ok) assertEquals(tooManyCas.error.code, "invalid_input");
  assertEquals(called, 0);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});
