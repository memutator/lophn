import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCAL_COMMANDS } from "../../coding-agent/mod.ts";
import { RESERVED_APP_SLUGS } from "../../protocol/apps/declaration/mod.ts";
import { wordsOf } from "../parser.ts";
import { COMMANDS } from "./mod.ts";

// 내장 명령 묶음의 첫 낱말을 앱 slug로 쓸 수 있으면 `lophn <slug> <command>`가 내장 명령과 부딪혀 앱 command가 가려진다.
test("every builtin command group is a reserved app slug", () => {
  for (const command of [...COMMANDS, ...LOCAL_COMMANDS]) {
    const group = wordsOf(command.name)[0];
    assert.ok(RESERVED_APP_SLUGS.includes(group), command.name);
  }
  assert.ok(RESERVED_APP_SLUGS.includes("help"));
  assert.ok(RESERVED_APP_SLUGS.includes("version"));
});
