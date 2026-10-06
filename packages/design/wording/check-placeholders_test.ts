import { assertEquals } from "@std/assert";
import { checkSource, errorsOf } from "./check.ts";
import { createTranslator } from "./format.ts";

const catalog = {
  "orders.label.count": "{count, plural, one {# order} other {# orders}}",
  "orders.label.owner": "Owned by {name} since {since}",
  "orders.title.screen": "Orders",
};

function rules(source: string): string[] {
  return errorsOf(
    checkSource("a.tsx", source, catalog, { screens: ["orders"] }),
  ).map((finding) => finding.rule);
}

Deno.test("shell/wording#R7: t 호출이 넘긴 값 이름이 문장의 placeholder와 다르면 오류다", () => {
  assertEquals(rules('const a = t("orders.label.count", { count: 2 });'), []);
  assertEquals(
    rules('const a = t("orders.label.owner", { since: s, name });'),
    [],
  );
  assertEquals(rules('const a = t("orders.title.screen");'), []);
  // 모자라거나 남거나 값 없이 부른다.
  assertEquals(rules('const a = t("orders.label.count", { total: 2 });'), [
    "placeholder-mismatch",
  ]);
  assertEquals(rules('const a = t("orders.label.owner", { name });'), [
    "placeholder-mismatch",
  ]);
  assertEquals(rules('const a = t("orders.label.count");'), [
    "placeholder-mismatch",
  ]);
  assertEquals(rules('const a = t("orders.title.screen", { x: 1 });'), [
    "placeholder-mismatch",
  ]);
  // 값을 펼치거나 변수로 넘기면 정적으로 알 수 없어 검사하지 않는다.
  assertEquals(rules('const a = t("orders.label.count", values);'), []);
  assertEquals(rules('const a = t("orders.label.count", { ...values });'), []);
});

Deno.test("apps/sdk#R41: createTranslator formats an app catalog with ICU in en only", () => {
  const t = createTranslator<typeof catalog, {
    "orders.label.count": { count: "plural" };
    "orders.label.owner": { name: "string"; since: "string" };
    "orders.title.screen": Record<never, never>;
  }>(catalog);
  assertEquals(t("orders.label.count", { count: 1 }), "1 order");
  assertEquals(t("orders.label.count", { count: 4 }), "4 orders");
  assertEquals(
    t("orders.label.owner", { name: "Kim", since: "May" }),
    "Owned by Kim since May",
  );
  assertEquals(t("orders.title.screen"), "Orders");
});
