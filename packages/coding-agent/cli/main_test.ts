// CLI entry의 exit 테스트다(cli#R2, R4). 표 밖 command·거절 입력에서
// invalid_input exit 2를 돌려주는지 본다. stream은 끼우지 않고 exit만 본다.
import { assertEquals } from "@std/assert";
import { cliMain } from "./main.ts";

Deno.test("coding-agent/cli#R4: 표 밖 command는 invalid_input exit 2다", async () => {
  const exit = await cliMain(["no-such", "command"]);
  assertEquals(exit, 2);
});

Deno.test("coding-agent/cli#R4: 모르는 option은 exit 2다", async () => {
  const exit = await cliMain(["document", "list", "--format", "json"]);
  assertEquals(exit, 2);
});

Deno.test("coding-agent/cli#R4: 둘 다 input source는 exit 2다", async () => {
  const exit = await cliMain([
    "document",
    "list",
    "--input",
    "{}",
    "--input-file",
    "input.json",
  ]);
  assertEquals(exit, 2);
});

Deno.test("coding-agent/cli#R4: command가 없으면 exit 2다", async () => {
  const exit = await cliMain([]);
  assertEquals(exit, 2);
});

Deno.test("coding-agent/cli#R2: 정상 help는 exit 0이다", async () => {
  const exit = await cliMain(["help"]);
  assertEquals(exit, 0);
});

Deno.test("coding-agent/cli#R2: version은 exit 0이다", async () => {
  const exit = await cliMain(["version"]);
  assertEquals(exit, 0);
});
