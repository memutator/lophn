import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { defineEvent } from "../../../protocol/events/mod.ts";
import { definePort } from "../../../protocol/base/mod.ts";
import {
  commands,
  deps,
  fileLedger,
  note,
  user,
  wideFixtureCase,
} from "./command-harness.ts";
import type { LedgerConnection } from "./sqlite.ts";
import { recordNote } from "./test-commands.ts";
import { openWriter, runCommand } from "./writer.ts";

const fixture = new URL("./writer-fixture.ts", import.meta.url);

const lateEvent = defineEvent("NoteCreated", {
  subject: z.string(),
  payload: z.strictObject({ name: z.string() }),
});

const anyPort = definePort<unknown>("any");

function events(connection: LedgerConnection, subject: string): unknown {
  return connection.sql.get(
    "select count(*) as n from events where subject = ?",
    [subject],
  )?.["n"];
}

// 닫힌 Tx의 모든 입구는 새 효과나 값을 주지 않고 던진다.
function assertSealed(tx: Tx) {
  const entries: [string, () => unknown][] = [
    ["sql.run", () => tx.sql.run("insert into events default values", [])],
    ["sql.get", () => tx.sql.get("select 1 as x", [])],
    ["sql.all", () => tx.sql.all("select 1 as x", [])],
    ["emit", () => tx.emit(lateEvent, "note:sealed", { name: "x" })],
    ["now", () => tx.now()],
    ["newId", () => tx.newId("cmd" as never)],
    ["port", () => tx.port(anyPort)],
    ["registerBlobRef", () => tx.registerBlobRef({} as never)],
    ["advanceSubscriberCursor", () => tx.advanceSubscriberCursor("s", "1")],
    [
      "useApproval",
      () => tx.useApproval("approval" as never, {} as never, {} as never),
    ],
    ["call", () => tx.call(recordNote, { name: "x" }, {})],
  ];
  for (const [label, entry] of entries) {
    assertThrows(entry, Error, "tx is closed", label);
  }
}

Deno.test("platform/ledger#R4: 거절된 async handler의 continuation은 gate 뒤에도 transaction 밖 event를 못 쓴다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-tx-" });
  const { connection } = await fileLedger(dir);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let continuation: Promise<unknown> | undefined;
  const asynchronous: CommandDefinition = {
    route: recordNote,
    handle(tx) {
      continuation = (async () => {
        await gate;
        tx.emit(lateEvent, "note:late", { name: "late" });
        return ok({ name: "late", seq: "0" });
      })();
      return continuation as never;
    },
  };
  const rejected = await runCommand(
    connection,
    deps(),
    [asynchronous],
    user(),
    note("a", "late"),
  );
  assert(!rejected.ok);
  if (!rejected.ok) assertEquals(rejected.error.code, "internal");
  release();
  const resumed = await continuation?.then(() => "wrote", () => "rejected");
  assertEquals(resumed, "rejected");
  assertEquals(events(connection, "note:late"), 0n);
  const next = await runCommand(
    connection,
    deps(),
    commands,
    user(),
    note("b", "after-late"),
  );
  assert(next.ok);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R4: 성공·거절·throw handler가 붙잡은 Tx는 끝나면 모든 입구가 닫힌다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-tx-" });
  const { connection } = await fileLedger(dir);
  const retained: Tx[] = [];
  const outcomes: [string, (tx: Tx) => unknown][] = [
    ["ok", () => ok({ name: "a", seq: "0" })],
    ["err", () => err({ code: "conflict", message: "거절" })],
    [
      "throw",
      () => {
        throw new Error("handler 실패");
      },
    ],
    ["thenable", () => Promise.resolve(ok({ name: "a", seq: "0" }))],
  ];
  for (const [label, outcome] of outcomes) {
    const keeping: CommandDefinition = {
      route: recordNote,
      handle(tx) {
        retained.push(tx);
        return outcome(tx) as never;
      },
    };
    await runCommand(
      connection,
      deps(),
      [keeping],
      user(),
      note("a", `keep-${label}`),
    );
  }
  assertEquals(retained.length, 4);
  for (const tx of retained) assertSealed(tx);
  // 붙잡힌 Tx는 뒤 command의 transaction 안에서도 닫혀 있다.
  const stale = retained[0];
  const reusing: CommandDefinition = {
    route: recordNote,
    handle(tx) {
      let sealed = false;
      try {
        stale.emit(lateEvent, "note:stale", { name: "stale" });
      } catch {
        sealed = true;
      }
      const seq = tx.emit(lateEvent, "note:fresh", { name: "fresh" });
      return ok({ name: sealed ? "sealed" : "open", seq });
    },
  };
  const reused = await runCommand(
    connection,
    deps(),
    [reusing],
    user(),
    note("a", "reuse"),
  );
  assert(reused.ok);
  if (reused.ok) {
    assertEquals((reused.value.result as { name: string }).name, "sealed");
  }
  assertEquals(events(connection, "note:stale"), 0n);
  assertEquals(events(connection, "note:fresh"), 1n);
  // 결과 getter도 handler 뒤에 읽히므로 닫힌 Tx를 쓰면 internal+rollback이다.
  const getter: CommandDefinition = {
    route: recordNote,
    handle(tx) {
      tx.emit(lateEvent, "note:getter", { name: "g" });
      return {
        ok: true,
        get value() {
          tx.emit(lateEvent, "note:getter-late", { name: "g" });
          return { name: "g", seq: "0" };
        },
      } as never;
    },
  };
  const gotten = await runCommand(
    connection,
    deps(),
    [getter],
    user(),
    note("a", "getter"),
  );
  assert(!gotten.ok);
  if (!gotten.ok) assertEquals(gotten.error.code, "internal");
  assertEquals(events(connection, "note:getter"), 0n);
  assertEquals(events(connection, "note:getter-late"), 0n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R4: 실제 Worker에서 붙잡힌 Tx·timer·늦은 continuation은 다음 transaction과 밖을 못 바꾼다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-tx-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, fixture);
  const kept = await writer.command(
    user(),
    wideFixtureCase("a", "retain", "w-retain"),
  );
  assert(kept.ok);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const reused = await writer.command(
    user(),
    wideFixtureCase("b", "use-retained", "w-reuse"),
  );
  assert(reused.ok);
  if (reused.ok) {
    assertEquals((reused.value.result as { extra: unknown }).extra, "closed");
  }
  const late = await writer.command(
    user(),
    wideFixtureCase("c", "late", "w-late"),
  );
  assert(!late.ok);
  if (!late.ok) assertEquals(late.error.code, "internal");
  await new Promise((resolve) => setTimeout(resolve, 60));
  const next = await writer.command(
    user(),
    wideFixtureCase("d", "ok", "w-next"),
  );
  assert(next.ok);
  await writer.close();
  const { connection: reader } = await fileLedger(dir);
  const subjects = reader.sql.all(
    "select subject from events order by seq",
    [],
  ).map((row) => row["subject"]);
  assertEquals(subjects, ["note:a", "note:b", "note:d"]);
  const results = reader.sql.get(
    "select count(*) as n from command_results",
    [],
  );
  assertEquals(results?.["n"], 3n);
  reader.close();
  await Deno.remove(dir, { recursive: true });
});
