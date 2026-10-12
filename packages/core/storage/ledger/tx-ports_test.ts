import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { defineEvent } from "../../../protocol/events/mod.ts";
import { definePort } from "../../../protocol/base/mod.ts";
import { deps, fileLedger, note, user } from "./command-harness.ts";
import { defineSyncCommand } from "./handler.ts";
import { openLedger } from "./mod.ts";
import type { LedgerConnection } from "./sqlite.ts";
import { recordNote } from "./test-commands.ts";
import { defineTxPort } from "./tx-ports.ts";
import { openWriter, runCommand } from "./writer.ts";

const fixture = new URL("./writer-port-fixture.ts", import.meta.url);
const created = defineEvent("NoteCreated", {
  subject: z.string(),
  payload: z.strictObject({ name: z.string() }),
});

type Reservation = { reserve(name: string): void };
type Domain = { readonly label: string; add(name: string): string };

function count(connection: LedgerConnection, table: string): unknown {
  return connection.sql.get(`select count(*) as n from ${table}`, [])?.["n"];
}

function probe(connection: LedgerConnection) {
  connection.sql.run("create table if not exists reservation (name text)", []);
  connection.sql.run("create table if not exists domain_item (name text)", []);
}

function named<T>(name: string, create: (tx: Tx) => T) {
  return defineTxPort(definePort<T>(name), create);
}

async function withLedger(
  body: (connection: LedgerConnection, path: string) => void | Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "lophn-ports-" });
  let connection: LedgerConnection | undefined;
  try {
    const opened = await fileLedger(dir);
    connection = opened.connection;
    await body(connection, opened.path);
  } finally {
    try {
      connection?.close();
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
}

Deno.test("platform/ledger#R3: reservation과 domain 변경·event·결과가 한 transaction에서 commit된다", async () => {
  await withLedger(async (connection) => {
    probe(connection);
    const reservation = named<Reservation>("documents.reservation", (tx) => ({
      reserve: (name) =>
        tx.sql.run("insert into reservation (name) values (?)", [name]),
    }));
    const domain = named<Domain>("apps.domain", (tx) => ({
      label: "app",
      add: (name) => {
        tx.sql.run("insert into domain_item (name) values (?)", [name]);
        return tx.emit(created, `item:${name}`, { name });
      },
    }));
    const bound = deps();
    bound.ports = [reservation, domain];
    const handler = defineSyncCommand(recordNote, (tx, _ctx, input) => {
      (tx.port(reservation.key) as Reservation).reserve(input.name);
      const seq = (tx.port(domain.key) as Domain).add(input.name);
      return ok({ name: (tx.port(domain.key) as Domain).label, seq });
    });
    const result = await runCommand(
      connection,
      bound,
      [handler],
      user(),
      note("a", "together"),
    );
    assert(result.ok);
    if (result.ok) assertEquals(result.value.result, { name: "app", seq: "1" });
    assertEquals(count(connection, "reservation"), 1n);
    assertEquals(count(connection, "domain_item"), 1n);
    assertEquals(count(connection, "events"), 1n);
    assertEquals(count(connection, "command_results"), 1n);
  });
});

Deno.test("platform/ledger#R3: port가 쓴 뒤 거절하면 reservation과 domain이 함께 rollback된다", async () => {
  await withLedger(async (connection) => {
    probe(connection);
    const reservation = named<Reservation>("documents.reservation", (tx) => ({
      reserve: (name) =>
        tx.sql.run("insert into reservation (name) values (?)", [name]),
    }));
    const domain = named<Domain>("apps.domain", (tx) => ({
      label: "app",
      add: (name) => {
        tx.sql.run("insert into domain_item (name) values (?)", [name]);
        return tx.emit(created, `item:${name}`, { name });
      },
    }));
    const bound = deps();
    bound.ports = [reservation, domain];
    const handler = defineSyncCommand(recordNote, (tx) => {
      (tx.port(reservation.key) as Reservation).reserve("a");
      (tx.port(domain.key) as Domain).add("a");
      return err({ code: "conflict", message: "함께 거절" });
    });
    const result = await runCommand(
      connection,
      bound,
      [handler],
      user(),
      note("a", "rollback"),
    );
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "conflict");
    assertEquals(count(connection, "reservation"), 0n);
    assertEquals(count(connection, "domain_item"), 0n);
    assertEquals(count(connection, "events"), 0n);
    assertEquals(count(connection, "command_results"), 0n);
  });
});

Deno.test("platform/ledger#R4: 반환 객체는 원본이고 붙잡힌 guarded Tx 효과만 seal 뒤에 거절한다", async () => {
  await withLedger(async (connection) => {
    probe(connection);
    class Counter {
      #n = 1;
      touch() {
        return this.#n;
      }
    }
    const frozen = Object.freeze(new Counter());
    const shared = { items: [1], self: undefined as unknown };
    shared.self = shared;
    Object.freeze(shared);
    const key = definePort<{ items: number[]; self: unknown }>("shape");
    const effect = definePort<{ write(): number }>("effect");
    const classKey = definePort<typeof frozen>("class");
    const arrayKey = definePort<readonly number[]>("array");
    const callable = Object.freeze(() => "pure");
    const callableKey = definePort<() => string>("callable");
    const bound = deps();
    bound.ports = [
      defineTxPort(key, () => shared),
      defineTxPort(classKey, () => frozen),
      defineTxPort(arrayKey, () => shared.items),
      defineTxPort(callableKey, () => callable),
      defineTxPort(effect, (tx) => ({
        write() {
          tx.sql.run("insert into reservation (name) values (?)", ["late"]);
          return frozen.touch();
        },
      })),
    ];
    let write: (() => number) | undefined;
    let retainedTx: Tx | undefined;
    const handler = defineSyncCommand(recordNote, (tx, _ctx, input) => {
      retainedTx = tx;
      assert(tx.port(classKey) === frozen);
      assertEquals(tx.port(classKey).touch(), 1);
      assert(tx.port(arrayKey) === shared.items);
      assert(Array.isArray(tx.port(arrayKey)));
      assert(tx.port(callableKey) === callable);
      assertEquals(tx.port(callableKey)(), "pure");
      const retained = tx.port(key);
      write = tx.port(effect).write;
      assert(retained === shared);
      assert(Array.isArray(retained.items));
      assert(retained.self === shared);
      assertEquals(Object.isFrozen(retained), true);
      assertEquals(write(), 1);
      return ok({ name: input.name, seq: "0" });
    });
    const result = await runCommand(
      connection,
      bound,
      [handler],
      user(),
      note("a", "shape"),
    );
    assert(result.ok);
    assertEquals(count(connection, "reservation"), 1n);
    assertThrows(() => write?.(), Error, "tx is closed");
    assert(retainedTx !== undefined);
    const sealed = retainedTx;
    for (
      const use of [
        () => sealed.sql.get("select 1", []),
        () => sealed.sql.all("select 1", []),
        () => sealed.emit(created, "late", { name: "late" }),
        () => sealed.now(),
        () => sealed.newId("doc"),
        () => sealed.port(key),
      ]
    ) assertThrows(use, Error, "tx is closed");
    // pure method와 값은 그대로다. seal이 막는 것은 captured Tx의 entry다.
    assertEquals(frozen.touch(), 1);
    assertEquals(callable(), "pure");
    assertEquals(count(connection, "reservation"), 1n);
    assertEquals(count(connection, "events"), 0n);
    const again = deps();
    again.ports = [defineTxPort(key, () => shared)];
    const reused = await runCommand(
      connection,
      again,
      [defineSyncCommand(recordNote, (tx) => {
        const value = tx.port(key) as { items: number[] };
        assert(value === shared);
        assert(Array.isArray(value.items));
        return ok({ name: "b", seq: "0" });
      })],
      user(),
      note("b", "reuse"),
    );
    assert(reused.ok);
  });
});

Deno.test("platform/ledger#R3: 같은 Tx는 port를 한 번만 만들고 다음 Tx는 새 구현이다", async () => {
  await withLedger(async (connection) => {
    const key = definePort<{ id: number }>("note");
    let made = 0;
    const bound = deps();
    bound.ports = [defineTxPort(key, () => ({ id: ++made }))];
    const handler = defineSyncCommand(recordNote, (tx, _ctx, input) => {
      const first = tx.port(key);
      return ok({
        name: `${first.id}:${tx.port(key).id}:${input.name}`,
        seq: "0",
      });
    });
    const first = await runCommand(
      connection,
      bound,
      [handler],
      user(),
      note("a", "cache-1"),
    );
    const second = await runCommand(
      connection,
      bound,
      [handler],
      user(),
      note("b", "cache-2"),
    );
    assert(first.ok && second.ok);
    if (first.ok) assertEquals(first.value.result, { name: "1:1:a", seq: "0" });
    if (second.ok) {
      assertEquals(second.value.result, { name: "2:2:b", seq: "0" });
    }
    assertEquals(made, 2);
  });
});

Deno.test("platform/ledger#R12: port가 쓰는 guarded Tx.sql도 변경 행 1,000개를 넘으면 rollback한다", async () => {
  await withLedger(async (connection) => {
    connection.sql.run("create table probe (x integer)", []);
    const key = definePort<{ fill(rows: number): void }>("bulk");
    const bound = deps();
    bound.ports = [defineTxPort(key, (tx) => ({
      fill(rows: number) {
        tx.sql.run(
          `with recursive n(x) as (values (1) union all select x+1 from n where x<${rows}) insert into probe select x from n`,
          [],
        );
      },
    }))];
    const handler = defineSyncCommand(recordNote, (tx) => {
      try {
        tx.port(key).fill(1001);
      } catch {
        // 한도 거절을 삼킨다.
      }
      return ok({ name: "a", seq: "0" });
    });
    const result = await runCommand(
      connection,
      bound,
      [handler],
      user(),
      note("a", "cap"),
    );
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "invalid_input");
    assertEquals(count(connection, "probe"), 0n);
  });
});

Deno.test("platform/ledger#R4: 실제 writer Worker의 port method는 같은 Tx에서만 행을 쓴다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-ports-" });
  let connection: LedgerConnection | undefined;
  let writer: ReturnType<typeof openWriter> | undefined;
  try {
    const opened = await fileLedger(dir);
    connection = opened.connection;
    connection.sql.run("create table reservation (name text)", []);
    connection.close();
    connection = undefined;
    writer = openWriter(opened.path, fixture);
    const wrote = await writer.command(user(), note("a", "worker"));
    assert(wrote.ok);
    if (wrote.ok) assertEquals(wrote.value.result, { name: "fixed", seq: "1" });
    connection = (await fileLedger(dir)).connection;
    assertEquals(count(connection, "reservation"), 1n);
    assertEquals(count(connection, "events"), 1n);
  } finally {
    try {
      await writer?.close();
    } finally {
      try {
        connection?.close();
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    }
  }
});

Deno.test("platform/ledger#R4: factory는 raw 연결이 아니라 guarded Tx만 받고 primitive 필드는 열린 Tx에서 쓴다", async () => {
  await withLedger((_connection, path) => {
    const key = definePort<{ mark: string; touch(): string }>("note");
    let seen: Tx | undefined;
    const ledger = openLedger(path, {
      ...deps(),
      ports: [defineTxPort(key, (tx) => {
        seen = tx;
        assertEquals(Object.hasOwn(tx, "sql"), true);
        assertEquals("exec" in tx, false);
        assertEquals("close" in tx, false);
        return { mark: "fixed", touch: () => tx.now() };
      })],
    });
    assert(ledger.ok);
    if (!ledger.ok) return;
    try {
      const result = ledger.value.transaction({ actor: "user" }, (tx) => {
        const value = tx.port(key);
        return ok(`${value.mark}${value.touch()}`);
      });
      assert(result.ok);
      if (result.ok) {
        assertEquals(result.value, "fixed2026-01-01T00:00:00.000Z");
      }
      assert(seen !== undefined);
    } finally {
      ledger.value.close();
    }
  });
});
