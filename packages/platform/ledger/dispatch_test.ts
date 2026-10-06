import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { defineCommand, type Tx } from "../../contracts/platform/mod.ts";
import { defineSyncCommand } from "./handler.ts";
import { commands, deps, fileLedger, user } from "./command-harness.ts";
import {
  markAlpha,
  markAlphaCommand,
  markBeta,
  markBetaCommand,
  recordNote,
} from "./test-commands.ts";
import { runCommand, runReadResult } from "./writer.ts";

const table = [...commands, markAlphaCommand, markBetaCommand];

function caller() {
  const ctx = user();
  return {
    ...ctx,
    scope: {
      operations: [
        ...ctx.scope.operations,
        "MarkAlpha",
        "MarkBeta",
        "D1",
        "D2",
        "D3",
        "D4",
        "D5",
      ],
      targets: {},
    },
  };
}

function beta(name: string, key = "beta-1") {
  return {
    command: "MarkBeta",
    input: { name },
    idempotency_key: key,
    compare: {},
    prepared: [] as string[],
  };
}

Deno.test("platform/ledger#R3: 다른 owner command는 같은 transaction의 seq로 차례대로 남는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-dispatch-" });
  const { connection } = await fileLedger(dir);
  const result = await runCommand(
    connection,
    deps(),
    table,
    caller(),
    beta("a"),
  );
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.replayed, false);
    assertEquals(result.value.first_seq, "1");
    assertEquals(result.value.last_seq, "2");
  }
  const events = connection.sql.all(
    "select seq, subject, actor from events order by seq",
    [],
  );
  assertEquals(events.map((row) => row["subject"]), ["alpha:a", "beta:a"]);
  assertEquals(events.map((row) => row["actor"]), ["user", "user"]);
  const stored = connection.sql.get(
    "select count(*) as n from command_results",
    [],
  );
  assertEquals(stored?.["n"], 1n);
  const own = runReadResult(
    connection,
    deps().checkCredential,
    caller(),
    "beta-1",
  );
  assert(own.ok && own.value !== null);
  if (own.ok && own.value) {
    assertEquals(own.value.result, { name: "a", seq: "2" });
  }
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R12: 불린 command의 CAS가 다르면 바깥 event도 없다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-dispatch-" });
  const { connection } = await fileLedger(dir);
  const bound = deps();
  const first = await runCommand(
    connection,
    bound,
    table,
    caller(),
    beta("a", "cas-first"),
  );
  assert(first.ok);
  const mismatch = defineSyncCommand(markBeta, (tx, _ctx, input) => {
    const called = tx.call(markAlpha, input, { seq: "9" });
    if (!called.ok) return called;
    return ok({ name: input.name, seq: called.value.seq });
  });
  const result = await runCommand(
    connection,
    bound,
    [markAlphaCommand, mismatch],
    caller(),
    beta("a", "cas-stale"),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "conflict");
  // 앞 확정은 남고, 낡은 CAS의 안쪽·바깥 event는 없다.
  assertEquals(
    connection.sql.get("select count(*) as n from events", [])?.["n"],
    2n,
  );
  assertEquals(
    connection.sql.get("select count(*) as n from command_results", [])?.["n"],
    1n,
  );
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R13: 바깥 command만 결과를 저장하고 재전달은 그 결과만 돌려준다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-dispatch-" });
  const { connection } = await fileLedger(dir);
  const bound = deps();
  const first = await runCommand(connection, bound, table, caller(), beta("a"));
  assert(first.ok);
  const again = await runCommand(
    connection,
    bound,
    table,
    { ...caller(), credential_ref: "rotated" },
    beta("a"),
  );
  assert(again.ok);
  if (again.ok) assertEquals(again.value.replayed, true);
  assertEquals(
    connection.sql.get("select count(*) as n from events", [])?.["n"],
    2n,
  );
  assertEquals(
    connection.sql.get("select count(*) as n from command_results", [])?.["n"],
    1n,
  );
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

function chain(depth: number) {
  const routes = Array.from({ length: depth }, (_, index) =>
    defineCommand({
      resource: "chain",
      method: `d${index + 1}`,
      name: `D${index + 1}`,
      input: z.strictObject({ name: z.string() }),
      output: z.strictObject({ name: z.string(), seq: z.string() }),
      compare: z.strictObject({}),
      actors: ["user"],
      errors: ["invalid_input"],
    }));
  const definitions = routes.map((route, index) =>
    defineSyncCommand(route, (tx, _ctx, input) => {
      const next = routes[index + 1];
      if (next !== undefined) {
        const called = tx.call(next, input, {});
        if (!called.ok) return called;
        return ok(called.value);
      }
      const seq = tx.emit(
        { type: "NoteCreated", payload: z.strictObject({ name: z.string() }) },
        `chain:${input.name}`,
        { name: input.name },
      );
      return ok({ name: input.name, seq });
    }, { dispatchable: true })
  );
  const outer = defineSyncCommand(markBeta, (tx, _ctx, input) => {
    const called = tx.call(routes[0]!, input, {});
    if (!called.ok) return called;
    return ok(called.value);
  });
  return { definitions, outer };
}

Deno.test("platform/ledger#R3: 등록되지 않은 이름, 자기 자신 순환, 깊이 4 초과는 거절한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-dispatch-" });
  const { connection } = await fileLedger(dir);
  const unknown = defineSyncCommand(markBeta, (tx, _ctx, input) => {
    const called = tx.call(markAlpha, input, {});
    if (!called.ok) return called;
    return ok({ name: input.name, seq: "0" });
  });
  const missing = await runCommand(
    connection,
    deps(),
    [unknown],
    caller(),
    beta("missing", "missing"),
  );
  assert(!missing.ok);
  if (!missing.ok) assertEquals(missing.error.code, "invalid_input");

  const hidden = defineSyncCommand(markBeta, (tx, _ctx, input) => {
    const called = tx.call(recordNote, { name: input.name }, {});
    if (!called.ok) return called;
    return ok({ name: input.name, seq: "0" });
  });
  const notDispatchable = await runCommand(
    connection,
    deps(),
    [...commands, hidden],
    caller(),
    beta("hidden", "hidden"),
  );
  assert(!notDispatchable.ok);
  if (!notDispatchable.ok) {
    assertEquals(notDispatchable.error.code, "invalid_input");
  }

  const mutualBeta = defineSyncCommand(markBeta, (tx, _ctx, input) => {
    const called = tx.call(markAlpha, input, {});
    if (!called.ok) return called;
    return ok(called.value);
  });
  const mutualAlpha = defineSyncCommand(markAlpha, (tx, _ctx, input) => {
    const called = tx.call(markBeta, input, {});
    if (!called.ok) return called;
    return ok(called.value);
  }, { dispatchable: true });
  const mutual = await runCommand(
    connection,
    deps(),
    [mutualAlpha, mutualBeta],
    caller(),
    beta("mutual", "mutual"),
  );
  assert(!mutual.ok);
  if (!mutual.ok) assertEquals(mutual.error.code, "invalid_input");

  // 바깥 command 자신도 경로에 있다. 안쪽이 그 이름을 다시 부르면 거절한다.
  const reenter = defineSyncCommand(markAlpha, (tx, _ctx, input) => {
    const called = tx.call(markBeta, input, {});
    if (!called.ok) return called;
    return ok(called.value);
  }, { dispatchable: true });
  const reentered = await runCommand(
    connection,
    deps(),
    [reenter, markBetaCommand],
    caller(),
    {
      command: "MarkAlpha",
      input: { name: "reenter" },
      idempotency_key: "reenter",
      compare: {},
      prepared: [],
    },
  );
  assert(!reentered.ok);
  if (!reentered.ok) assertEquals(reentered.error.code, "invalid_input");

  const loop = defineSyncCommand(markAlpha, (tx, _ctx, input) => {
    const called = tx.call(markAlpha, input, {});
    if (!called.ok) return called;
    return ok(called.value);
  }, { dispatchable: true });
  const cycle = await runCommand(connection, deps(), [loop], caller(), {
    command: "MarkAlpha",
    input: { name: "loop" },
    idempotency_key: "loop",
    compare: {},
    prepared: [],
  });
  assert(!cycle.ok);
  if (!cycle.ok) assertEquals(cycle.error.code, "invalid_input");

  const allowed = chain(4);
  const within = await runCommand(
    connection,
    deps(),
    [...allowed.definitions, allowed.outer],
    caller(),
    beta("four", "four"),
  );
  assert(within.ok);
  const kept = connection.sql.get("select count(*) as n from events", [])
    ?.["n"];

  const tooDeep = chain(5);
  const depth = await runCommand(
    connection,
    deps(),
    [...tooDeep.definitions, tooDeep.outer],
    caller(),
    beta("five", "five"),
  );
  assert(!depth.ok);
  if (!depth.ok) assertEquals(depth.error.code, "invalid_input");
  assertEquals(
    connection.sql.get("select count(*) as n from events", [])?.["n"],
    kept,
  );
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R12: 불린 command는 원래 actor 상한과 schema를 다시 검사한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-dispatch-" });
  const { connection } = await fileLedger(dir);
  const ctx = caller();
  ctx.scope.operations = ctx.scope.operations.filter((name) =>
    name !== "MarkAlpha"
  );
  const narrow = await runCommand(
    connection,
    deps(),
    table,
    ctx,
    beta("narrow", "narrow"),
  );
  assert(!narrow.ok);
  if (!narrow.ok) assertEquals(narrow.error.code, "forbidden");

  const bad = defineSyncCommand(markBeta, (tx, _ctx, input) => {
    const called = tx.call(
      markAlpha,
      { name: input.name, extra: true } as never,
      {},
    );
    if (!called.ok) return called;
    return ok({ name: input.name, seq: called.value.seq });
  });
  const schema = await runCommand(
    connection,
    deps(),
    [markAlphaCommand, bad],
    caller(),
    beta("schema", "schema"),
  );
  assert(!schema.ok);
  if (!schema.ok) assertEquals(schema.error.code, "invalid_input");
  assertEquals(
    connection.sql.get("select count(*) as n from events", [])?.["n"],
    0n,
  );
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R3: 어느 하나라도 실패하면 전체 rollback이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-dispatch-" });
  const { connection } = await fileLedger(dir);
  const failing = defineSyncCommand(markBeta, (tx, _ctx, input) => {
    const called = tx.call(markAlpha, input, {});
    if (!called.ok) return called;
    return err({ code: "conflict", message: "바깥이 거절한다" });
  });
  const result = await runCommand(
    connection,
    deps(),
    [markAlphaCommand, failing],
    caller(),
    beta("roll", "roll"),
  );
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "conflict");
  assertEquals(
    connection.sql.get("select count(*) as n from events", [])?.["n"],
    0n,
  );
  assertEquals(
    connection.sql.get("select count(*) as n from command_results", [])?.["n"],
    0n,
  );
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/approvals#R7: dispatch 전용 command는 직접 호출에서 없는 command와 같게 거절되고 기록이 없지만 tx.call로는 같은 transaction에서 불린다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-dispatch-" });
  const { connection } = await fileLedger(dir);
  const only = { ...markAlphaCommand, dispatchOnly: true };
  const events = () =>
    connection.sql.get("select count(*) as n from events", [])?.["n"];
  const direct = (key: string) => ({
    command: "MarkAlpha",
    input: { name: "direct" },
    idempotency_key: key,
    compare: {},
    prepared: [] as string[],
  });

  // 같은 이름의 command가 아예 없을 때의 답이 기준이다.
  const absent = await runCommand(
    connection,
    deps(),
    [markBetaCommand],
    caller(),
    direct("absent"),
  );
  assert(!absent.ok);
  const refused = await runCommand(
    connection,
    deps(),
    [only, markBetaCommand],
    caller(),
    direct("direct"),
  );
  assert(!refused.ok);
  assertEquals(refused.error, absent.error);
  assertEquals(refused.error.code, "invalid_input");
  assertEquals(events(), 0n);
  assertEquals(
    connection.sql.get("select count(*) as n from command_results", [])?.["n"],
    0n,
  );

  // 직접 호출이 허용되는 같은 command는 불린다(표시가 있는 command만 막힌다).
  const open = await runCommand(
    connection,
    deps(),
    [markAlphaCommand, markBetaCommand],
    caller(),
    direct("open"),
  );
  assert(open.ok);
  assertEquals(events(), 1n);

  // 바깥 command가 tx.call로 부르면 같은 transaction에서 처리된다.
  const dispatched = await runCommand(
    connection,
    deps(),
    [only, markBetaCommand],
    caller(),
    beta("via", "via"),
  );
  assert(dispatched.ok);
  if (dispatched.ok) {
    assertEquals(dispatched.value.last_seq, "3");
  }
  assertEquals(events(), 3n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

// 부른 쪽에는 상대 표 SQL이 없다. alpha 행은 MarkAlpha handler의 emit뿐이다.
void 0 as unknown as Tx;
