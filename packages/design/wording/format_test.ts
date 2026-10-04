import { IntlMessageFormat } from "intl-messageformat";
import { assert, assertEquals } from "@std/assert";
import { t } from "./format.ts";
import {
  formatDate,
  formatDateTooltip,
  formatNumber,
  formatRelativeTime,
} from "./intl.ts";
import { en } from "./en.ts";
import { render } from "./generate.ts";

Deno.test("shell/wording#R3: placeholder와 plural은 ICU 문장이 처리하고 문장 조각을 잇지 않는다", () => {
  const catalog = {
    "things-to-confirm.count.label":
      "{count, plural, one {# thing to confirm} other {# things to confirm}}",
    "app-detail.release.body": "{appName} will switch to {version}.",
  };
  const count = new IntlMessageFormat(
    catalog["things-to-confirm.count.label"],
    "en",
  );
  assertEquals(count.format({ count: 1 }), "1 thing to confirm");
  assertEquals(count.format({ count: 3 }), "3 things to confirm");
  const body = new IntlMessageFormat(catalog["app-detail.release.body"], "en");
  assertEquals(
    body.format({ appName: "Budget", version: "3" }),
    "Budget will switch to 3.",
  );
});

Deno.test("shell/wording#R14: 날짜·숫자·상대 시각은 Intl로만 만든다", () => {
  const date = new Date("2026-09-26T00:00:00Z");
  assertEquals(
    formatDate(date, "en", { month: "short", day: "numeric", timeZone: "UTC" }),
    "Sep 26",
  );
  assertEquals(
    formatDateTooltip(date, "en").includes("2026"),
    true,
  );
  assertEquals(formatNumber(1500, "en"), "1,500");
  assertEquals(formatNumber(100_000, "en"), "100K");
  const now = new Date("2026-09-26T00:03:00Z");
  const earlier = new Date("2026-09-26T00:00:00Z");
  assertEquals(formatRelativeTime(earlier, now, "en"), "3 minutes ago");
});

Deno.test("shell/wording#R14: 표 칸은 compact 없이, 변화량은 부호를 붙여 Intl로 만든다", () => {
  assertEquals(
    formatNumber(1_234_567, "en", { notation: "standard" }),
    "1,234,567",
  );
  assertEquals(formatNumber(1_234_567, "en"), "1.2M");
  assertEquals(formatNumber(12, "en", { sign: true }), "+12");
  assertEquals(formatNumber(-3.5, "en", { sign: true }), "-3.5");
  assertEquals(formatNumber(0, "en", { sign: true }), "0");
  const date = new Date("2026-09-26T13:05:00Z");
  const options = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  } as const;
  assertEquals(
    formatDate(date, "en", options),
    new Intl.DateTimeFormat("en", options).format(date),
  );
});

Deno.test("shell/wording#R1: 고정 문구는 message key로만 나오고 버튼·제목은 마침표가 없다", () => {
  assertEquals(
    t("common.notification.body"),
    "Something needs your attention.",
  );
  assertEquals(t("common.notification.title"), "lophn");
  assertEquals(t("document.diff.identical"), "These versions are identical.");
  assert(!en["common.notification.title"].endsWith("."));
  assert(en["common.notification.body"].endsWith("."));
});

Deno.test("shell/wording#R7: placeholder 종류가 다르면 생성 타입이 갈라진다", () => {
  const catalog = {
    "things-to-confirm.count.label":
      "{count, plural, one {# thing to confirm} other {# things to confirm}}",
    "app-detail.release.body": "{appName} will switch to {version}.",
  };
  const rendered = render(catalog);
  assert(rendered.includes('count: "plural"'));
  assert(rendered.includes('appName: "string"'));
  assert(rendered.includes('version: "string"'));
  assert(!rendered.includes('count: "string"'));
});

Deno.test("shell/wording#R14: 생성한 placeholder 타입이 en catalog와 같다", async () => {
  const current = await Deno.readTextFile(
    new URL("./placeholders.ts", import.meta.url),
  );
  assertEquals(current, render(en));
});
