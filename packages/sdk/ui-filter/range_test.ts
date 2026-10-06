import { assertEquals } from "@std/assert";
import { parseDay, resolveRange } from "./range.ts";

const now = new Date(2026, 9, 6, 15, 30);

Deno.test("apps/sdk#R18: 기간은 오늘을 포함한 달력 날짜의 양 끝으로 풀린다", () => {
  assertEquals(resolveRange({ preset: "today" }, now), {
    from: "2026-10-06",
    to: "2026-10-06",
  });
  assertEquals(resolveRange({ preset: "last-7-days" }, now), {
    from: "2026-09-30",
    to: "2026-10-06",
  });
  assertEquals(
    resolveRange({ preset: "last-30-days" }, now).from,
    "2026-09-07",
  );
  assertEquals(
    resolveRange({ preset: "last-90-days" }, now).from,
    "2026-07-09",
  );
  assertEquals(resolveRange({ preset: "this-month" }, now), {
    from: "2026-10-01",
    to: "2026-10-06",
  });
  assertEquals(
    resolveRange(
      { preset: "custom", from: "2026-10-03", to: "2026-09-28" },
      now,
    ),
    { from: "2026-09-28", to: "2026-10-03" },
  );
  assertEquals(parseDay("2026-02-30"), undefined);
  assertEquals(parseDay("2026-2-3"), undefined);
});
