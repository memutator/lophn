import { assertEquals } from "@std/assert";
import {
  axisDate,
  axisNumber,
  exactNumber,
  tooltipDate,
  valueRange,
} from "./format.ts";

const en = { locale: "en", timeZone: "UTC" };
const day = new Date("2026-09-26T15:00:00Z");

Deno.test("shell/design-system#R41: 축은 10만 이상만 compact로 줄이고 tooltip 값은 줄이지 않는다", () => {
  assertEquals(axisNumber(99_999, en), "99,999");
  assertEquals(axisNumber(100_000, en), "100K");
  assertEquals(axisNumber(2_400_000, en), "2.4M");
  assertEquals(exactNumber(2_400_000, en), "2,400,000");
});

Deno.test("shell/design-system#R41: 축 날짜는 Sep 26, tooltip 날짜는 Sep 26, 2026 (Sat)이다", () => {
  assertEquals(axisDate(day, en), "Sep 26");
  assertEquals(tooltipDate(day, en), "Sep 26, 2026 (Sat)");
});

Deno.test("shell/design-system#R41: 숫자와 날짜는 locale과 시간대를 따른다", () => {
  assertEquals(exactNumber(1234.5, { locale: "de" }), "1.234,5");
  assertEquals(axisDate(day, { locale: "de", timeZone: "UTC" }), "26. Sept.");
  assertEquals(
    axisDate(new Date("2026-09-26T23:30:00Z"), {
      locale: "en",
      timeZone: "Asia/Seoul",
    }),
    "Sep 27",
  );
  assertEquals(valueRange(0, 10, en), "0–10");
});
