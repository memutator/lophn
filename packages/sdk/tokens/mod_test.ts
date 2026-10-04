import { assertEquals } from "@std/assert";
import * as design from "@lophn/design";
import * as sdk from "./mod.ts";
import { otherColor, seriesColors } from "./examples/chart-colors.ts";

Deno.test("apps/sdk#R4: @lophn/tokens는 정확한 1.0.0으로 낸다", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("./deno.json", import.meta.url)),
  );
  assertEquals(config.name, "@lophn/tokens");
  assertEquals(config.version, "1.0.0");
});

Deno.test("apps/sdk#R20: @lophn/tokens는 shell/design-system token과 같은 값을 낸다", () => {
  assertEquals(sdk.tokens, design.tokens);
  assertEquals(sdk.vars, design.vars);
  assertEquals(sdk.tokenNames, design.tokenNames);
});

Deno.test("shell/design-system#R11: 예제는 8 slot 계열 색과 기타 회색 token을 읽는다", () => {
  assertEquals(seriesColors("light"), [
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#4a3aa7",
    "#e34948",
  ]);
  assertEquals(seriesColors("dark")[0], "#3987e5");
  assertEquals(otherColor, "var(--chart-other)");
});
