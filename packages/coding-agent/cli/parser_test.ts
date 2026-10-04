// CLI parser·거절 테스트다(cli#R4). 모르는 option·값 없는 option·중복·둘 다
// input source·`--input-file -`를 실행 전 거절하는지 본다. 파서만 본다.
import { assertEquals } from "@std/assert";
import { parseArgs, splitCommand } from "./parser.ts";

Deno.test("coding-agent/cli#R4: 알 수 없는 option은 errors로 거절한다", () => {
  const parsed = parseArgs(["document", "list", "--format", "json"]);
  assertEquals(parsed.errors, ["알 수 없는 option이다: --format"]);
});

Deno.test("coding-agent/cli#R4: 값 없는 option은 errors로 거절한다", () => {
  const parsed = parseArgs(["document", "list", "--connection"]);
  assertEquals(parsed.errors, ["option에 값이 없다: --connection"]);
});

Deno.test("coding-agent/cli#R4: option 중복은 errors로 거절한다", () => {
  const parsed = parseArgs([
    "document",
    "list",
    "--connection",
    "cac_1",
    "--connection",
    "cac_2",
  ]);
  assertEquals(parsed.errors, ["option이 중복된다: --connection"]);
  assertEquals(parsed.connection, "cac_2");
});

Deno.test("coding-agent/cli#R4: --input과 --input-file은 둘 다 거절이다", () => {
  const parsed = parseArgs([
    "document",
    "list",
    "--input",
    "{}",
    "--input-file",
    "input.json",
  ]);
  assertEquals(parsed.errors, ["input and input_file are exclusive"]);
});

Deno.test("coding-agent/cli#R4: --input-file - (stdin)은 지원하지 않는다", () => {
  const parsed = parseArgs(["document", "list", "--input-file", "-"]);
  assertEquals(parsed.errors, ["--input-file - (stdin)은 지원하지 않는다"]);
});

Deno.test("coding-agent/cli#R4: command 뒤의 위치 인자는 positional으로 남는다", () => {
  const parsed = parseArgs(["index", "root", "more"]);
  assertEquals(parsed.errors, []);
  assertEquals(parsed.command, "index");
  assertEquals(parsed.positional, ["root", "more"]);
});

Deno.test("coding-agent/cli#R4: command는 <group> <command> 모양만 푼다", () => {
  // splitCommand는 표 밖 3부분 command를 거절이다.
  const parsed = parseArgs(["document list extra"]);
  assertEquals(parsed.errors, []);
  const ref = splitCommand("document list extra");
  assertEquals(ref.ok, false);
  if (!ref.ok) {
    assertEquals(ref.error.code, "invalid_input");
    assertEquals(
      ref.error.message.includes("command는 <group> <command> 모양이다"),
      true,
    );
  }
});

Deno.test("coding-agent/cli#R4: 정상 argv는 command와 flag 값을 유지한다", () => {
  const parsed = parseArgs([
    "document",
    "list",
    "--json",
    "--input",
    '{"state":"draft"}',
  ]);
  assertEquals(parsed.errors, []);
  assertEquals(parsed.command, "document");
  assertEquals(parsed.positional, ["list"]);
  assertEquals(parsed.json, true);
  assertEquals(parsed.input, '{"state":"draft"}');
});

Deno.test("coding-agent/cli#R4: help·version은 command로 푼다", () => {
  assertEquals(splitCommand("help"), {
    ok: true,
    value: { group: "help", name: undefined },
  });
  assertEquals(splitCommand("version"), {
    ok: true,
    value: { group: "version", name: undefined },
  });
});
