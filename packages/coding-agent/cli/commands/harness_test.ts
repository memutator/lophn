// `lophn harness` command 테스트다(coding-agent/cli#R40, T28). 표 네 command,
// 재감지 요청 판정, inspect 선택값을 본다. 감지 자체는 harnesses leaf의
// 테스트가 맡는다.
import { assert, assertEquals } from "@std/assert";
import { findCommand } from "../registry.ts";
import {
  HARNESS_COMMANDS,
  inspectTargetOf,
  refreshRequestedBy,
} from "./harness.ts";

Deno.test("coding-agent/cli#R40: harness list·detect·refresh·inspect 네 command가 표에 있다", () => {
  assertEquals(HARNESS_COMMANDS.length, 4);
  for (
    const name of [
      "harness list",
      "harness detect",
      "harness refresh",
      "harness inspect",
    ]
  ) {
    const entry = findCommand(name);
    assert(entry !== undefined);
    // command field까지 맞아야 한다(withCommon).
    assertEquals(
      entry.input.safeParse({ command: name }).success,
      true,
    );
  }
  // 공통 선택값도 받는다(cliCommonSchema).
  const listed = findCommand("harness list");
  assert(listed !== undefined);
  assertEquals(
    listed.input.safeParse({ command: "harness list", json: true }).success,
    true,
  );
});

Deno.test("coding-agent/cli#R40: refresh만 재감지를 먹는다", () => {
  // refresh command만 사람 요청 재감지다(R2, harnesses 확인).
  assertEquals(refreshRequestedBy("harness refresh"), true);
  assertEquals(refreshRequestedBy("harness detect"), false);
  assertEquals(refreshRequestedBy("harness list"), false);
  assertEquals(refreshRequestedBy("harness inspect"), false);
});

Deno.test("coding-agent/cli#R40: inspect는 선택 제품을 받고 없으면 전체다", () => {
  assertEquals(inspectTargetOf({ harness: "codex" }), "codex");
  assertEquals(inspectTargetOf({}), undefined);
});
