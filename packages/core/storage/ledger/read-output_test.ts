import { assert, assertEquals, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ok } from "../../../base/mod.ts";
import {
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
  withReadCommon,
} from "../../../protocol/platform/mod.ts";
import { createReaderPool } from "./reader-pool.ts";
import { createReaderConnection } from "./reader-connection.ts";
import {
  createReaderRegistration,
  outputRead,
  zeroRead,
} from "./read-output-fixture.ts";
import { executeRead } from "./reads.ts";

const ctx: RequestContext = {
  principal: "user",
  actor: "user",
  credential_ref: "fixture",
  scope: { operations: [], targets: {} },
  conditions: {},
};

const invalid = [
  "function_extra",
  "symbol_extra",
  "undefined_extra",
  "zero_extra",
  "nan_extra",
  "symbol_key",
  "metadata_extra",
  "negative_zero",
  "details_extra",
  "details_zero",
] as const;
const safeOutput = { data: 1, as_of_seq: "1", next_cursor: null };

Deno.test("platform/ledger#R14: direct reader는 raw 비JSON extra와 -0을 schema strip 전에 거절하고 snapshot을 닫는다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "create table events(seq integer primary key); insert into events values(1)",
  );
  const connection = createReaderConnection(db);
  const { reads, ports } = createReaderRegistration();
  try {
    for (const mode of invalid) {
      const result = executeRead(connection, reads[0], ports, ctx, { mode });
      assert(!result.ok, mode);
      assertEquals(result.error.code, "internal", mode);
      assertEquals(result.error.message, "read 처리에 실패했다", mode);
      assertEquals(db.isTransaction, false, mode);
      assertEquals(
        executeRead(connection, reads[0], ports, ctx, { mode: "valid" }),
        { ok: true, value: safeOutput },
      );
    }
    const zero = executeRead(connection, reads[1], ports, ctx, {});
    assert(!zero.ok);
    assertEquals(zero.error.code, "internal");
    const kept = executeRead(connection, reads[0], ports, ctx, {
      mode: "json_extra",
    });
    assertEquals(kept, { ok: true, value: safeOutput });
    assertEquals(db.isTransaction, false);
  } finally {
    connection.close();
  }
});

Deno.test("platform/ledger#R14: output getter와 schema 작업은 snapshot 밖이며 최종 JSON의 schema 값이 불변이다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "create table events(seq integer primary key); insert into events values(1)",
  );
  const connection = createReaderConnection(db);
  let retained: ReadSnapshot | undefined;
  let gets = 0;
  const definition: ReadDefinition = {
    route: {
      ...outputRead,
      output: withReadCommon(
        z.object({ data: z.number().transform((value) => value + 1) }),
      ),
    },
    handle(snapshot) {
      retained = snapshot;
      return ok({
        get data() {
          gets++;
          assertEquals(db.isTransaction, false);
          assertThrows(() => retained!.sql.get("select 1", []));
          return 1;
        },
        next_cursor: null,
      });
    },
  };
  try {
    const result = executeRead(connection, definition, new Map(), ctx, {
      mode: "valid",
    });
    assert(!result.ok);
    assertEquals(result.error.code, "internal");
    assertEquals(gets, 1);
    assertEquals(db.isTransaction, false);
    assertThrows(() => retained!.sql.all("select 1", []));
  } finally {
    connection.close();
  }
});

Deno.test("platform/ledger#R14: 두 실제 Worker도 raw extra·-0·details를 거절하고 JSON extra strip과 다음 read는 유지한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ledger-output-" });
  const path = `${dir}/ledger.db`;
  const writer = new DatabaseSync(path);
  writer.exec(
    "pragma journal_mode=WAL; create table events(seq integer primary key); insert into events values(1)",
  );
  const opened = await createReaderPool(path, [
    new URL("./read-output-fixture.ts", import.meta.url),
  ]);
  try {
    assert(opened.ok);
    const pool = opened.value;
    for (const mode of invalid) {
      const results = await Promise.all(
        [0, 1].map(() => pool.read(outputRead, ctx, { mode })),
      );
      for (const result of results) {
        assert(!result.ok, mode);
        assertEquals(result.error.code, "internal", mode);
      }
      const next = await pool.read(outputRead, ctx, { mode: "valid" });
      assertEquals(next, { ok: true, value: safeOutput });
      assertEquals(pool.health(), ["healthy", "healthy"]);
    }
    const zero = await pool.read(zeroRead, ctx, {});
    assert(!zero.ok);
    assertEquals(zero.error.code, "internal");
    assertEquals(await pool.read(outputRead, ctx, { mode: "json_extra" }), {
      ok: true,
      value: safeOutput,
    });
    assertEquals(await pool.read(outputRead, ctx, { mode: "plain_zero" }), {
      ok: true,
      value: { ...safeOutput, data: 0 },
    });
    for (const mode of ["valid_error", "json_error_extra"]) {
      assertEquals(await pool.read(outputRead, ctx, { mode }), {
        ok: false,
        error: { code: "invalid_input", message: "fixture failure" },
      });
    }
  } finally {
    if (opened.ok) opened.value.close();
    writer.close();
    await Deno.remove(dir, { recursive: true });
  }
});
