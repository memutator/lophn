import assert from "node:assert/strict";
import { test } from "node:test";

import { ALL_ROUTES } from "../../../../../packages/contracts/mod.ts";

import { isAllowed, lookupCall } from "./allowlist.ts";

test("shell/desktop#R19: renderer allowlist는 contract의 read·command만 담는다", () => {
  let reads = 0;
  let commands = 0;
  for (const route of ALL_ROUTES) {
    const allowed = isAllowed(route.kind, route.resource, route.method);
    if (route.kind === "read" || route.kind === "command") {
      assert.equal(allowed, true, `${route.resource}/${route.method}`);
      if (route.kind === "read") reads += 1;
      else commands += 1;
    } else {
      assert.equal(
        allowed,
        false,
        `${route.kind} ${route.resource}/${route.method}`,
      );
    }
  }
  assert.ok(reads > 0);
  assert.ok(commands > 0);
});

test("shell/desktop#R19: 임의 credential 발급과 daemon 종료 통로는 없다", () => {
  for (const method of ["issue", "revoke", "shutdown", "stop", "quit"]) {
    assert.equal(lookupCall("command", "identity", method), undefined);
    assert.equal(lookupCall("command", "platform", method), undefined);
  }
  assert.equal(isAllowed("command", "identity", "issue"), false);
  assert.equal(isAllowed("read", "platform", "status"), true);
});

test("shell/desktop#R19: allowlist 이름은 route 이름 그대로다", () => {
  const name = lookupCall("read", "platform", "status");
  assert.equal(name, "read:platform/status");
});
