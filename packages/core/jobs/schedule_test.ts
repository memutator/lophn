import assert from "node:assert/strict";
import { test } from "node:test";
import { dueTurns, firstDue } from "./schedule.ts";

// 서머타임이 바뀌는 날에 차례가 둘이 되거나 사라지면 job이 하루 두 번 돌거나 하루를 거른다.
test("an at job has one turn a day on the days the clock changes", () => {
  const zone = "America/New_York";

  // 봄: 02:30이 없는 날은 시계가 건너뛴 03:00(EDT)이 그날 차례다.
  const spring = { every: "1d", at: "02:30", zone };
  assert.deepStrictEqual(
    dueTurns(spring, "2026-03-07T07:30:00.000Z", "2026-03-08T12:00:00.000Z"),
    {
      count: 2,
      last: "2026-03-08T07:00:00.000Z",
      next: "2026-03-09T06:30:00.000Z",
    },
  );
  assert.deepStrictEqual(
    firstDue(spring, "2026-03-07T07:30:00.000Z"),
    "2026-03-08T07:00:00.000Z",
  );
  assert.deepStrictEqual(
    firstDue(spring, "2026-03-08T07:00:00.000Z"),
    "2026-03-09T06:30:00.000Z",
  );

  // 가을: 01:30이 두 번 오는 날도 첫 번째 한 번만 돈다.
  const fall = { every: "1d", at: "01:30", zone };
  assert.deepStrictEqual(
    dueTurns(fall, "2026-10-31T05:30:00.000Z", "2026-11-01T07:00:00.000Z"),
    {
      count: 2,
      last: "2026-11-01T05:30:00.000Z",
      next: "2026-11-02T06:30:00.000Z",
    },
  );
  assert.deepStrictEqual(
    firstDue(fall, "2026-10-31T05:30:00.000Z"),
    "2026-11-01T05:30:00.000Z",
  );
  assert.deepStrictEqual(
    firstDue(fall, "2026-11-01T05:30:00.000Z"),
    "2026-11-02T06:30:00.000Z",
  );
  assert.deepStrictEqual(
    firstDue(fall, "2026-11-01T06:30:00.000Z"),
    "2026-11-02T06:30:00.000Z",
  );
});
