// `lophn harness` command 테스트다(coding-agent/cli#R40, T28). 표 네 command,
// 재감지 요청 판정, inspect 선택값을 본다. 감지 자체는 harnesses leaf의
// 테스트가 맡는다.
import { assert, assertEquals } from "@std/assert";
import { findCommand } from "../registry.ts";
import {
  HARNESS_COMMANDS,
  inspectTargetOf,
  refreshRequestedBy,
  writesFiles,
  writeTargetOf,
} from "./harness.ts";

Deno.test("coding-agent/cli#R40: harness 여덟 command가 표에 있다", () => {
  assertEquals(HARNESS_COMMANDS.length, 8);
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
    assertEquals(entry.input.safeParse({ command: name }).success, true);
  }
  // 관리 쓰기는 target·components가 필수다(cli#R40). command만으로는 거절한다.
  const write = {
    target: HOST,
    components: ["mcp"],
  };
  for (
    const name of [
      "harness plan",
      "harness install",
      "harness update",
      "harness remove",
    ]
  ) {
    const entry = findCommand(name);
    assert(entry !== undefined);
    const input = name === "harness install"
      ? { command: name, ...write, operation_id: "op-1" }
      : { command: name, ...write };
    assertEquals(entry.input.safeParse(input).success, true);
    assertEquals(entry.input.safeParse({ command: name }).success, false);
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

const HOST = {
  scope_kind: "user" as const,
  environment: { kind: "host" as const, identity: "fixture" },
  profile_id: null,
  harness_id: "claude" as const,
  app: null,
  app_realpath: null,
};

Deno.test("coding-agent/cli#R40: 관리 쓰기만 파일을 고치고 고른 target 하나만 받는다", () => {
  for (
    const name of [
      "harness plan",
      "harness install",
      "harness update",
      "harness remove",
    ]
  ) {
    assertEquals(writesFiles(name), true);
  }
  // 감지 command는 파일을 고치지 않는다(R6 확인).
  for (
    const name of [
      "harness list",
      "harness detect",
      "harness refresh",
      "harness inspect",
    ]
  ) {
    assertEquals(writesFiles(name), false);
  }
  assertEquals(writeTargetOf({ target: HOST }), "claude");
  assertEquals(writeTargetOf({}), undefined);
});
