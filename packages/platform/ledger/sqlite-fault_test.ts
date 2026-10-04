import { assert, assertEquals, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err } from "../../base/mod.ts";
import type { CommandDefinition } from "../../contracts/platform/mod.ts";
import { commands, deps, fileLedger, note, user } from "./command-harness.ts";
import { isStorageUnavailable } from "./sqlite.ts";
import { recordNote } from "./test-commands.ts";
import { runCommand, runReadResult } from "./writer.ts";

type Method = "exec" | "close";

// 실제 native DatabaseSync의 exec·close를 잠시 바꾼다. 테스트가 끝나면 원래 정의로 되돌린다.
function patchNative(
  method: Method,
  replace: (original: (...args: unknown[]) => unknown) => (
    this: DatabaseSync,
    ...args: unknown[]
  ) => unknown,
): () => void {
  const proto = DatabaseSync.prototype as unknown as Record<string, unknown>;
  const own = Object.getOwnPropertyDescriptor(proto, method);
  const original = proto[method] as (...args: unknown[]) => unknown;
  proto[method] = replace(original);
  return () => {
    if (own === undefined) delete proto[method];
    else Object.defineProperty(proto, method, own);
  };
}

Deno.test("platform/ledger#R6: native rollback·close가 둘 다 실패해도 close는 한 번만 시도하고 모든 SQL 입구가 닫힌다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-fault-" });
  const { connection } = await fileLedger(dir);
  let closeAttempts = 0;
  let leaked: DatabaseSync | undefined;
  const restoreExec = patchNative(
    "exec",
    (original) =>
      function (this: DatabaseSync, ...args: unknown[]) {
        if (String(args[0]).trim().toLowerCase() === "rollback") {
          throw new Error("native rollback exploded: secret path /etc/x");
        }
        return original.apply(this, args);
      },
  );
  const restoreClose = patchNative(
    "close",
    () =>
      function (this: DatabaseSync) {
        closeAttempts += 1;
        leaked = this;
        throw new Error("native close exploded: secret path /etc/x");
      },
  );
  try {
    const rejecting: CommandDefinition = {
      route: recordNote,
      handle: () => err({ code: "conflict", message: "거절" }) as never,
    };
    const failed = await runCommand(
      connection,
      deps(),
      [rejecting],
      user(),
      note("a", "poison"),
    );
    assert(!failed.ok);
    if (!failed.ok) {
      assertEquals(failed.error.code, "unavailable");
      assertEquals(failed.error.message, "ledger에 기록할 수 없다");
    }
    assertEquals(closeAttempts, 1);
    assert(connection.failed());
    // native handle은 실제로 아직 열려 있다. 그래도 연결 입구는 쓰지 못한다.
    assert(leaked?.isOpen);
    assertEquals(connection.inTransaction(), false);
    assertEquals(connection.integrityOk(), false);
    for (
      const entry of [
        () => connection.sql.get("select 1 as x", []),
        () => connection.sql.all("select 1 as x", []),
        () => connection.sql.run("insert into events default values", []),
        () => connection.exec("begin immediate"),
      ]
    ) {
      const thrown = assertThrows(entry);
      assert(isStorageUnavailable(thrown));
      assert(!String((thrown as Error).message).includes("secret"));
    }
    const nextCommand = await runCommand(
      connection,
      deps(),
      commands,
      user(),
      note("a", "after"),
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
    connection.fault();
    connection.close();
    connection.close();
    assertEquals(closeAttempts, 1);
  } finally {
    restoreClose();
    restoreExec();
    if (leaked?.isOpen) leaked.close();
  }
  // 되돌린 뒤 다른 연결은 평소대로 열고 닫힌다.
  const fresh = await fileLedger(dir);
  assertEquals(fresh.connection.integrityOk(), true);
  fresh.connection.close();
  await Deno.remove(dir, { recursive: true });
});
