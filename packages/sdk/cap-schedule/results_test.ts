import { assertEquals, assertThrows } from "@std/assert";
import { continueRead, decodeContinuation, readResult } from "./mod.ts";

const query = { filter: { day: "2026-10-04" }, order: ["at"], basis: "usage" };

Deno.test("apps/invocations#R14: read result separates empty, partial and stale, and rejects a changed continuation", () => {
  const empty = readResult([], { coverage: "complete", freshness: "fresh" });
  assertEquals(empty.rows, []);
  assertEquals(empty.coverage, "complete");
  assertEquals(empty.continuation, null);

  const missing = readResult<{ id: string }>([], {
    coverage: "uncollected",
    freshness: "unknown",
  });
  assertEquals(missing.coverage, "uncollected");
  assertEquals(missing.freshness, "unknown");

  const partial = readResult([{ id: "1" }], {
    coverage: "partial",
    freshness: "stale",
    continuation: { query, cursor: "1" },
  });
  assertEquals(partial.coverage, "partial");
  assertEquals(partial.freshness, "stale");
  const decoded = decodeContinuation(partial.continuation!);
  assertEquals(decoded.cursor, "1");

  const next = continueRead(decoded, query, [{ id: "2" }], {
    coverage: "complete",
    freshness: "fresh",
  });
  assertEquals(next.rows, [{ id: "2" }]);
  assertThrows(() =>
    continueRead(decoded, { ...query, order: ["name"] }, [], {
      coverage: "complete",
      freshness: "fresh",
    })
  );
});
