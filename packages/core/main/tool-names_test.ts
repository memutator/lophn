import assert from "node:assert/strict";
import { test } from "node:test";
import { RESERVED_DOMAIN_NAMES } from "../../protocol/apps/declaration/mod.ts";
import { toWireToolName } from "../../protocol/lophn-agent/tool-catalog.ts";
import { TOOL_ORDER } from "../agent-roles/tool-lists.ts";

// 새 내장 자원을 더하고 예약을 잊으면 같은 이름의 domain이 앱 tool 이름을 내장 tool과 겹치게 해서 session의 tool 목록 전체가
// `conflict`로 막히고 tool.load 묶음도 섞인다.
test("every builtin tool's resource name is a reserved domain name", () => {
  for (const name of TOOL_ORDER) {
    const resource = toWireToolName(name).split("_")[0];
    assert.ok(RESERVED_DOMAIN_NAMES.includes(resource), `${name}: ${resource}`);
  }
});
