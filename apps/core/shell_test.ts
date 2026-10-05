import { assertEquals } from "@std/assert";
import { validateDefinition } from "../../packages/platform/settings/mod.ts";
import { tokens } from "../../packages/design/tokens.ts";

import { readingWidthSetting } from "./shell.ts";

Deno.test("shell/design-system#R23: 전역 읽기 폭 설정 항목은 settings registry가 받는 정의다", () => {
  assertEquals(validateDefinition(readingWidthSetting).ok, true);
  // 고를 수 있는 값은 design token의 세 읽기 폭과 같다.
  assertEquals(
    readingWidthSetting.value_type.options,
    Object.keys(tokens.page.reading),
  );
  assertEquals(readingWidthSetting.value_type.safeParse("huge").success, false);
  assertEquals(readingWidthSetting.default, "default");
});
