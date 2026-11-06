import assert from "node:assert/strict";
import { test } from "node:test";
import { cmdShimCommand } from "./cmd-shim.ts";

// .cmd launcher에 JSON 인자를 넘기는 길이 두 번 깨졌다(따옴표 없이 이었다). 따옴표와 cmd 메타문자가 escape되어야 한다.
test("cmd launcher 인자의 따옴표·공백·메타문자는 escape되고 launcher 경로의 공백도 escape된다", () => {
  const run = cmdShimCommand("cmd.exe", "C:\\a b\\lophn.cmd", [
    '{"a":"b c"}',
    "x&y",
  ]);
  assert.deepStrictEqual(run.command, "cmd.exe");
  assert.deepStrictEqual(run.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.deepStrictEqual(
    run.args[3],
    '"C:\\a^ b\\lophn.cmd ^^^"{\\^^^"a\\^^^":\\^^^"b^^^ c\\^^^"}^^^" ^^^"x^^^&y^^^""',
  );
});
