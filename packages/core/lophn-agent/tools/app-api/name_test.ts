import { assertEquals, assertMatch } from "@std/assert";
import { WIRE_TOOL_NAME_PATTERN } from "../../../../protocol/lophn-agent/tool-catalog.ts";
import { appApiToolName } from "./name.ts";

const APP = "app_01zzzzzzzzzzzzzzzzzzzzzzzz";

Deno.test("app-api tool 이름은 wire 이름 모양이고 같은 입력이면 같다", async () => {
  assertEquals(await appApiToolName(APP, "add"), `app__${APP}__add`);
  const long = await appApiToolName(APP, "x".repeat(80));
  assertEquals(long, await appApiToolName(APP, "x".repeat(80)));
  assertEquals(long.length, 64);
  // wire 밖 글자가 든 이름은 서로 다른 이름으로 남는다.
  const dotted = await appApiToolName(APP, "a.b");
  assertMatch(dotted, WIRE_TOOL_NAME_PATTERN);
  assertEquals(dotted === await appApiToolName(APP, "a_b"), false);
});
