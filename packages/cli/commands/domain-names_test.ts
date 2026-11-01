import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCAL_COMMANDS } from "../../coding-agent/mod.ts";
import { RESERVED_DOMAIN_NAMES } from "../../protocol/apps/declaration/mod.ts";
import { wordsOf } from "../parser.ts";
import { COMMANDS } from "./mod.ts";

// 내장 명령 묶음의 첫 낱말을 domain 이름으로 쓸 수 있으면 `lophn <domain> <command>`가 내장 명령과 부딪혀 앱 command가 가려진다.
test("every builtin command group is a reserved domain name", () => {
  for (const command of [...COMMANDS, ...LOCAL_COMMANDS]) {
    const group = wordsOf(command.name)[0];
    assert.ok(RESERVED_DOMAIN_NAMES.includes(group), command.name);
  }
  assert.ok(RESERVED_DOMAIN_NAMES.includes("help"));
  assert.ok(RESERVED_DOMAIN_NAMES.includes("version"));
});
