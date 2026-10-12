import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  type Clock,
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../../base/mod.ts";
import { defineEvent } from "../../../protocol/server/mod.ts";
import { LEDGER_SCHEMA_STEPS, openLedger } from "./mod.ts";
import { applyMigrations } from "../migration/mod.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");

function deps(clock: Clock = manualClock(START)) {
  return {
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    registerBlobRef: () =>
      err({ code: "internal" as const, message: "blob 등록 없음" }),
    call: () => err({ code: "internal" as const, message: "dispatch 없음" }),
  };
}

async function openedLedger(dir: string, clock?: Clock) {
  const path = `${dir}/ledger.db`;
  const applied = await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
    clock: clock ?? manualClock(START),
  });
  if (!applied.ok) return applied;
  return openLedger(path, deps(clock));
}

async function tempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "lophn-ledger-" });
}

const created = defineEvent("ThingCreated", {
  subject: z.string(),
  payload: z.strictObject({ name: z.string() }),
});

Deno.test(
  "platform/ledger#R10: 확정 event와 command 결과는 고치거나 지우지 못한다",
  async () => {
    const dir = await tempDir();
    const opened = await openedLedger(dir);
    assert(opened.ok);
    if (!opened.ok) return;
    const ledger = opened.value;
    const wrote = ledger.transaction({ actor: "user" }, (tx) => {
      tx.emit(created, "thing:1", { name: "a" });
      tx.sql.run(
        "insert into command_results (principal, idempotency_key, fingerprint, result, first_seq, last_seq, at) values (?, ?, ?, ?, ?, ?, ?)",
        ["user", "k", "f", "{}", 1, 1, tx.now()],
      );
      return ok(undefined);
    });
    assert(wrote.ok);
    const changed = ledger.transaction({ actor: "user" }, (tx) => {
      tx.sql.run("update events set type = ? where seq = ?", ["X", 1]);
      return ok(undefined);
    });
    assert(!changed.ok);
    const removed = ledger.transaction({ actor: "user" }, (tx) => {
      tx.sql.run("delete from command_results", []);
      return ok(undefined);
    });
    assert(!removed.ok);
    const left = ledger.transaction(
      { actor: "user" },
      (tx) => ok(tx.sql.get("select type from events where seq = ?", [1])),
    );
    assert(left.ok);
    if (left.ok) assertEquals(left.value?.["type"], "ThingCreated");
    ledger.close();
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/ledger#R7: 없는 event를 가리키는 command 결과는 거절한다",
  async () => {
    const dir = await tempDir();
    const opened = await openedLedger(dir);
    assert(opened.ok);
    if (!opened.ok) return;
    const result = opened.value.transaction({ actor: "user" }, (tx) => {
      tx.sql.run(
        "insert into command_results (principal, idempotency_key, fingerprint, result, first_seq, last_seq, at) values (?, ?, ?, ?, ?, ?, ?)",
        ["user", "k", "f", "{}", 1, 1, tx.now()],
      );
      return ok(undefined);
    });
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "internal");
    opened.value.close();
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/ledger#R8: ID는 IdSource에서, 시각은 Clock에서 온다",
  async () => {
    const dir = await tempDir();
    const clock = manualClock(START);
    const opened = await openedLedger(dir, clock);
    assert(opened.ok);
    if (!opened.ok) return;
    const result = opened.value.transaction({ actor: "machine" }, (tx) => {
      const id = tx.newId("doc");
      const at = tx.now();
      tx.emit(created, id, { name: "a" });
      return ok({ id, at });
    });
    assert(result.ok);
    if (result.ok) {
      assert(result.value.id.startsWith("doc_"));
      assertEquals(result.value.at, "2026-01-01T00:00:00.000Z");
    }
    clock.advance(1500);
    const later = opened.value.transaction(
      { actor: "machine" },
      (tx) => ok(tx.now()),
    );
    assert(later.ok);
    if (later.ok) assertEquals(later.value, "2026-01-01T00:00:01.500Z");
    opened.value.close();
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/ledger#R9: event seq는 transaction 안에서 단조로 늘고 십진 문자열이다",
  async () => {
    const dir = await tempDir();
    const opened = await openedLedger(dir);
    assert(opened.ok);
    if (!opened.ok) return;
    const first = opened.value.transaction({ actor: "user", run: undefined }, (
      tx,
    ) => ok([tx.emit(created, "thing:1", { name: "a" })]));
    assert(first.ok);
    if (first.ok) assertEquals(first.value, ["1"]);
    const second = opened.value.transaction({ actor: "user" }, (tx) =>
      ok([
        tx.emit(created, "thing:1", { name: "b" }),
        tx.emit(created, "thing:2", { name: "c" }),
      ]));
    assert(second.ok);
    if (second.ok) assertEquals(second.value, ["2", "3"]);
    opened.value.close();

    const reopened = openLedger(`${dir}/ledger.db`, deps());
    assert(reopened.ok);
    if (!reopened.ok) return;
    const third = reopened.value.transaction(
      { actor: "user" },
      (tx) => ok(tx.emit(created, "thing:1", { name: "d" })),
    );
    assert(third.ok);
    if (third.ok) assertEquals(third.value, "4");
    reopened.value.close();
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/ledger#R9: 안전 정수보다 큰 seq도 십진 문자열로 정확하다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const opened = await openedLedger(dir);
    assert(opened.ok);
    if (!opened.ok) return;
    opened.value.close();
    const big = 2n ** 53n + 5n;
    const db = new DatabaseSync(path);
    db.prepare("insert into sqlite_sequence (name, seq) values (?, ?)").run(
      "events",
      big,
    );
    db.close();
    const reopened = openLedger(path, deps());
    assert(reopened.ok);
    if (!reopened.ok) return;
    const result = reopened.value.transaction(
      { actor: "user" },
      (tx) => ok(tx.emit(created, "thing:1", { name: "a" })),
    );
    assert(result.ok);
    if (result.ok) assertEquals(result.value, (big + 1n).toString());
    const stored = reopened.value.transaction(
      { actor: "user" },
      (tx) => ok(tx.sql.get("select seq from events", [])),
    );
    assert(stored.ok);
    if (stored.ok) assertEquals(stored.value?.["seq"], big + 1n);
    reopened.value.close();
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/ledger#R3: 중첩 transaction과 handler의 자체 commit은 거절한다",
  async () => {
    const dir = await tempDir();
    const opened = await openedLedger(dir);
    assert(opened.ok);
    if (!opened.ok) return;
    const ledger = opened.value;
    const nested = ledger.transaction({ actor: "user" }, () => {
      return ledger.transaction(
        { actor: "user" },
        (tx) => ok(tx.emit(created, "thing:1", { name: "a" })),
      );
    });
    assert(!nested.ok);
    if (!nested.ok) assertEquals(nested.error.code, "invalid_input");
    const committed = ledger.transaction({ actor: "user" }, (tx) => {
      tx.sql.run("commit", []);
      return ok(undefined);
    });
    assert(!committed.ok);
    if (!committed.ok) assertEquals(committed.error.code, "invalid_input");
    const several = ledger.transaction({ actor: "user" }, (tx) => {
      tx.sql.run("select 1; select 2", []);
      return ok(undefined);
    });
    assert(!several.ok);
    if (!several.ok) assertEquals(several.error.code, "invalid_input");
    // 열 이름 release는 첫 keyword가 아니라 통과한다.
    const named = ledger.transaction(
      { actor: "user" },
      (tx) => ok(tx.sql.get("select 'release' as release", [])),
    );
    assert(named.ok);
    if (named.ok) assertEquals(named.value?.["release"], "release");
    const count = ledger.transaction(
      { actor: "user" },
      (tx) => ok(tx.sql.get("select count(*) as n from events", [])),
    );
    assert(count.ok);
    if (count.ok) assertEquals(count.value?.["n"], 0n);
    ledger.close();
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/ledger#R3: handler가 err를 돌리면 transaction 전체가 rollback된다",
  async () => {
    const dir = await tempDir();
    const opened = await openedLedger(dir);
    assert(opened.ok);
    if (!opened.ok) return;
    const result = opened.value.transaction({ actor: "user" }, (tx) => {
      tx.emit(created, "thing:1", { name: "a" });
      return err({ code: "conflict", message: "거절" });
    });
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "conflict");
    const count = opened.value.transaction(
      { actor: "user" },
      (tx) => ok(tx.sql.get("select count(*) as n from events", [])),
    );
    assert(count.ok);
    if (count.ok) assertEquals(count.value?.["n"], 0n);
    opened.value.close();
    await Deno.remove(dir, { recursive: true });
  },
);
