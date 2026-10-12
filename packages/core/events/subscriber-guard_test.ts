import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  deps,
  fileLedger,
  machine,
  note,
  user,
} from "../storage/ledger/command-harness.ts";
import { advanceSubscriberCursorCommand } from "../storage/ledger/commands.ts";
import { defineSyncCommand } from "../storage/ledger/handler.ts";
import {
  createSubscriberGate,
  type SubscriberGate,
} from "./subscriber-registration.ts";
import { noteCreated, recordNote } from "../storage/ledger/test-commands.ts";
import { runCommand } from "../storage/ledger/writer.ts";

Deno.test("platform/ledger#R15 platform/api#R7: gate 결과 inspection 거절을 삼켜도 domain·event·결과는 rollback하고 owner 원문은 숨긴다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "subscriber-guard-" });
  const { connection } = await fileLedger(dir);
  connection.sql.run("create table reactions(value text)", []);
  const hooks: Record<string, () => unknown> = {
    "null": () => null,
    missing: () => ({ ok: true }),
    boolean: () => ok(true),
    extra: () => ({ ...ok(undefined), extra: "private" }),
    hidden: () => Object.defineProperty(ok(undefined), "extra", { value: 1 }),
    symbol: () => ({ ...ok(undefined), [Symbol("private")]: 1 }),
    accessor: () =>
      Object.defineProperty({}, "ok", {
        enumerable: true,
        get() {
          throw new Error("private getter");
        },
      }),
    "own-key-trap": () =>
      new Proxy(ok(undefined), {
        ownKeys() {
          throw new Error("private ownKeys");
        },
      }),
    "then-trap": () =>
      new Proxy(ok(undefined), {
        has() {
          throw new Error("private then inspection");
        },
      }),
    thenable: () =>
      Object.defineProperty(ok(undefined), "then", {
        value: (resolve: (value: unknown) => void) => resolve(ok(undefined)),
      }),
    promise: () => Promise.resolve(ok(undefined)),
    rejected: () => Promise.reject(new Error("private rejection")),
    "thrown-promise": () => {
      throw Promise.reject(new Error("private throw"));
    },
    throwing: () => {
      throw new Error("private throw");
    },
    forbidden: () => err({ code: "forbidden", message: "private owner" }),
    unauthorized: () => err({ code: "unauthorized", message: "private owner" }),
  };
  const swallowed = defineSyncCommand(recordNote, (tx, _ctx, input) => {
    tx.sql.run("insert into reactions values(?)", [input.name]);
    try {
      tx.advanceSubscriberCursor("notes", "1");
    } catch {
      // sticky failure 뒤 다른 효과와 성공을 시도하는 handler다.
    }
    const seq = tx.emit(noteCreated, `note:${input.name}`, {
      name: input.name,
    });
    return ok({ name: input.name, seq });
  });
  try {
    for (const [name, hook] of Object.entries(hooks)) {
      let calls = 0;
      const subscriberGate: SubscriberGate = () => {
        calls++;
        return hook() as never;
      };
      const result = await runCommand(
        connection,
        { ...deps(), subscriberGate },
        [swallowed],
        user(),
        note(name, name),
      );
      assertEquals(calls, 1, name);
      assert(!result.ok, name);
      assertEquals(
        result.error.code,
        name === "forbidden" || name === "unauthorized" ? name : "unavailable",
        name,
      );
      assert(!JSON.stringify(result).includes("private"), name);
      for (
        const table of [
          "reactions",
          "events",
          "subscriber_cursors",
          "command_results",
        ]
      ) {
        assertEquals(
          connection.sql.get(`select count(*) as n from ${table}`, [])?.n,
          0n,
          name,
        );
      }
    }
    const kept = await runCommand(
      connection,
      { ...deps(), subscriberGate: () => ok(undefined) },
      [swallowed],
      user(),
      note("kept", "kept"),
    );
    assert(kept.ok);
    assertEquals(
      connection.sql.get("select count(*) as n from reactions", [])?.n,
      1n,
    );
    assertEquals(
      connection.sql.get("select count(*) as n from events", [])?.n,
      1n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R3 platform/ledger#R11 platform/ledger#R15: BEGIN 뒤 current full context만 gate에 주며 handler mutation은 scope를 넓히지 못한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "subscriber-current-" });
  const { connection } = await fileLedger(dir);
  const run = "run_00000000000000000000000000";
  const current = {
    ...user(),
    scope: { operations: ["RecordNote"], targets: {} },
    conditions: { run, task: "build", process: "worker-generation" },
  };
  let checked = 0;
  let gated = 0;
  const subscriberGate: SubscriberGate = (_name, ctx) => {
    gated++;
    assertEquals(ctx, { ...current, run });
    return ctx.scope.operations.includes("AdvanceSubscriberCursor")
      ? ok(undefined)
      : err({ code: "forbidden", message: "private scope" });
  };
  const mutating = defineSyncCommand(recordNote, (tx, ctx, input) => {
    ctx.scope.operations.push("AdvanceSubscriberCursor");
    ctx.conditions.task = "changed";
    ctx.principal = "forged";
    ctx.credential_ref = "forged";
    try {
      tx.advanceSubscriberCursor("notes", "1");
    } catch { /* swallowed */ }
    const seq = tx.emit(noteCreated, `note:${input.name}`, {
      name: input.name,
    });
    return ok({ name: input.name, seq });
  });
  try {
    const result = await runCommand(
      connection,
      {
        ...deps(),
        subscriberGate,
        checkCredential: () => {
          checked++;
          assert(connection.inTransaction());
          return ok(structuredClone(current));
        },
      },
      [mutating],
      user(),
      note("mutating", "mutating"),
    );
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
    assertEquals(checked, 1);
    assertEquals(gated, 1);
    assertEquals(
      connection.sql.get("select count(*) as n from events", [])?.n,
      0n,
    );
    assertEquals(
      connection.sql.get("select count(*) as n from command_results", [])?.n,
      0n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R15: 이전 gate가 받은 context mutation은 같은 Tx의 다음 cursor 권한을 넓히지 못한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "subscriber-mutation-" });
  const { connection } = await fileLedger(dir);
  const current = user();
  let calls = 0;
  const subscriberGate: SubscriberGate = (name, ctx) => {
    calls++;
    assertEquals(ctx, current);
    if (name === "first") {
      ctx.scope.operations.push("second");
      ctx.principal = "forged";
      ctx.conditions.task = "changed";
      return ok(undefined);
    }
    return ctx.scope.operations.includes("second")
      ? ok(undefined)
      : err({ code: "forbidden", message: "private owner" });
  };
  const reaction = defineSyncCommand(recordNote, (tx, _ctx, input) => {
    tx.advanceSubscriberCursor("first", "1");
    try {
      tx.advanceSubscriberCursor("second", "2");
    } catch { /* swallowed */ }
    const seq = tx.emit(noteCreated, `note:${input.name}`, {
      name: input.name,
    });
    return ok({ name: input.name, seq });
  });
  try {
    const result = await runCommand(
      connection,
      { ...deps(), subscriberGate },
      [reaction],
      current,
      note("reaction", "reaction"),
    );
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
    assertEquals(calls, 2);
    assertEquals(
      connection.sql.get("select count(*) as n from subscriber_cursors", [])?.n,
      0n,
    );
    assertEquals(
      connection.sql.get("select count(*) as n from command_results", [])?.n,
      0n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R12 platform/ledger#R15: machine standalone도 cursor CAS SQL 전에 owner를 검사하고 허용 위치만 event 없이 commit한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "subscriber-cas-" });
  const { connection } = await fileLedger(dir);
  let allowed = false;
  let calls = 0;
  let cursorReads = 0;
  const nativeGet = connection.sql.get;
  connection.sql.get = (sql, params) => {
    if (sql.includes("from subscriber_cursors")) cursorReads++;
    return nativeGet(sql, params);
  };
  const gate = createSubscriberGate([{
    name: "notes",
    authorize: (ctx) => {
      calls++;
      assertEquals(ctx, machine());
      return ok(allowed);
    },
  }]);
  assert(gate.ok);
  const envelope = (key: string, compare: string) => ({
    command: "AdvanceSubscriberCursor",
    input: { subscriber: "notes", scanned_through_seq: "1" },
    idempotency_key: key,
    compare: { processed_through_seq: compare },
    prepared: [],
  });
  try {
    const bound = { ...deps(), subscriberGate: gate.value };
    const denied = await runCommand(
      connection,
      bound,
      [advanceSubscriberCursorCommand],
      machine(),
      envelope("denied", "9"),
    );
    assert(!denied.ok);
    assertEquals(denied.error.code, "forbidden");
    assertEquals(calls, 1);
    assertEquals(cursorReads, 0);
    const { subscriberGate: _gate, ...missing } = bound;
    const absent = await runCommand(
      connection,
      missing,
      [advanceSubscriberCursorCommand],
      machine(),
      envelope("absent", "0"),
    );
    assert(!absent.ok);
    assertEquals(absent.error.code, "unavailable");
    assertEquals(cursorReads, 0);
    allowed = true;
    const kept = await runCommand(
      connection,
      bound,
      [advanceSubscriberCursorCommand],
      machine(),
      envelope("kept", "0"),
    );
    assert(kept.ok);
    assertEquals(kept.value.result, { processed_through_seq: "1" });
    assertEquals(kept.value.wake, false);
    assertEquals(calls, 3);
    assertEquals(cursorReads, 2);
    assertEquals(
      connection.sql.get("select count(*) as n from events", [])?.n,
      0n,
    );
    assertEquals(
      connection.sql.get("select count(*) as n from command_results", [])?.n,
      1n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});
