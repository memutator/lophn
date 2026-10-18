import { assertEquals } from "@std/assert";
import { nextWeekTuesdays } from "./dates.ts";

// 주 경계에서 틀리면 Operator가 맞게 일정을 넣어도 calendar-api가 거짓으로 떨어진다.
Deno.test("nextWeekTuesdays는 월요일 시작과 일요일 시작 두 규칙의 화요일을 낸다", () => {
  const table: [Date, string[]][] = [
    [new Date(2026, 9, 17), ["2026-10-20"]], // 토
    [new Date(2026, 9, 18), ["2026-10-20", "2026-10-27"]], // 일: 두 규칙이 갈린다
    [new Date(2026, 9, 19), ["2026-10-27"]], // 월
    [new Date(2026, 9, 20), ["2026-10-27"]], // 화
    [new Date(2026, 11, 29), ["2027-01-05"]], // 해를 넘긴다
  ];
  for (const [now, want] of table) {
    assertEquals(nextWeekTuesdays(now), want);
  }
});
