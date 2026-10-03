import { assert, assertEquals, assertThrows } from "@std/assert";
import { formatAt, manualClock, systemClock } from "./clock.ts";

const AT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

Deno.test("platform/ledger#R8: 기록 시각은 UTC ISO 8601 밀리초다", () => {
  const clock = manualClock(Date.UTC(2026, 9, 4, 1, 2, 3, 4));
  assertEquals(clock.now(), "2026-10-04T01:02:03.004Z");
  assertEquals(clock.nowMs(), Date.UTC(2026, 9, 4, 1, 2, 3, 4));
  assert(AT.test(clock.now()));

  clock.advance(1);
  assertEquals(clock.now(), "2026-10-04T01:02:03.005Z");
  clock.set(Date.UTC(1999, 0, 1, 0, 0, 0, 0));
  assertEquals(clock.now(), "1999-01-01T00:00:00.000Z");

  assert(AT.test(systemClock.now()));
  assertEquals(formatAt(0), "1970-01-01T00:00:00.000Z");
  assertThrows(() => formatAt(Number.NaN));
});
