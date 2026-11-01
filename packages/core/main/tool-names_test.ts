import assert from "node:assert/strict";
import { test } from "node:test";
import { RESERVED_DOMAIN_NAMES } from "../../protocol/apps/declaration/mod.ts";
import { toWireToolName } from "../../protocol/lophn-agent/tool-catalog.ts";
import { TOOL_ORDER } from "../agent-places/tool-lists.ts";

// 새 내장 자원을 더하고 예약을 잊으면 같은 이름의 domain이 앱 command의 wire 이름(`<domain>_<command>`)을 내장 tool과 겹치게 해서 session의
// tool 표 전체가 `conflict`로 막힌다. 내장 명령 묶음의 첫 낱말은 `cli/commands/domain-names_test.ts`가 본다.
test("every builtin tool's resource name is a reserved domain name", () => {
  for (const name of TOOL_ORDER) {
    // `lophn` tool은 자원이 아니라 명령 표의 입구다. 앱 command의 wire 이름은 늘 `<domain>_<command>`라 이 이름과 겹치지 않는다.
    if (name === "lophn") continue;
    const resource = toWireToolName(name).split("_")[0];
    assert.ok(RESERVED_DOMAIN_NAMES.includes(resource), `${name}: ${resource}`);
  }
});
