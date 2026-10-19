import { assertEquals, assertMatch } from "@std/assert";
import { WIRE_TOOL_NAME_PATTERN } from "../../../../protocol/lophn-agent/tool-catalog.ts";
import { appApiToolName } from "./name.ts";

Deno.test("앱 tool 이름은 wire 이름 모양이고 같은 입력이면 같다", async () => {
  assertEquals(await appApiToolName("notes", "add"), "domain__notes__add");
  const long = await appApiToolName("notes", "x".repeat(80));
  assertEquals(long, await appApiToolName("notes", "x".repeat(80)));
  assertEquals(long.length, 64);
  // wire 밖 글자가 든 이름은 서로 다른 이름으로 남는다.
  const dotted = await appApiToolName("notes", "a.b");
  assertMatch(dotted, WIRE_TOOL_NAME_PATTERN);
  assertEquals(dotted === await appApiToolName("notes", "a_b"), false);
});
