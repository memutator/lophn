import assert from "node:assert/strict";
import { test } from "node:test";
import { err, manualClock } from "../../../base/mod.ts";
import type { LedgerConnection } from "./sqlite.ts";
import { runTransaction, type TxDeps } from "./tx.ts";

// corrupt 파일에는 다시 쓰지 않는다. 연결이 fault되고 다음 transaction은 SQL 없이 끝나야 한다.
test("corrupt failure faults the connection and later transactions run no SQL", () => {
  const statements: string[] = [];
  let dead = false;
  const connection = {
    exec(sql: string) {
      if (dead) throw new Error("used after fault");
      statements.push(sql);
      if (sql === "begin immediate") {
        throw Object.assign(new Error("database disk image is malformed"), {
          errcode: 11,
        });
      }
    },
    inTransaction: () => false,
    fault: () => {
      dead = true;
    },
    failed: () => dead,
  } as unknown as LedgerConnection;
  const deps = {
    clock: manualClock(0),
    ids: { newId: () => "x" },
    ports: [],
    registerBlobRef: () => err({ code: "internal", message: "unused" }),
    call: () => err({ code: "internal", message: "unused" }),
  } as unknown as TxDeps;
  const ctx = { actor: "usr_x", turn: null };
  const run = () => runTransaction(connection, ctx, deps, () => assert.fail());

  const first = run();
  assert.equal(first.ok, false);
  assert.equal(!first.ok && first.error.code, "unavailable");
  assert.equal(connection.failed(), true);

  const before = statements.length;
  const second = run();
  assert.equal(!second.ok && second.error.code, "unavailable");
  assert.equal(statements.length, before);
});
