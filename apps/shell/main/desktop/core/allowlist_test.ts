import assert from "node:assert/strict";
import { test } from "node:test";

import { ALL_ROUTES } from "../../../../../packages/contracts/mod.ts";

import { isAllowed, lookupCall, READING_WORKER_ROUTES } from "./allowlist.ts";

test("shell/desktop#R19: renderer allowlist는 contract의 read·command와 문서 읽기 worker만 담는다", () => {
  let reads = 0;
  let commands = 0;
  for (const route of ALL_ROUTES) {
    const allowed = isAllowed(route.kind, route.resource, route.method);
    const name = `${route.kind}:${route.resource}/${route.method}`;
    if (route.kind === "worker" && READING_WORKER_ROUTES.includes(name)) {
      assert.equal(allowed, true, name);
    } else if (route.kind === "read" || route.kind === "command") {
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

test("shell/editor#R7: 문서 읽기 worker는 outline·본문 읽기뿐이고 준비·파일 쓰기 worker는 막는다", () => {
  assert.equal(isAllowed("worker", "outline", "document"), true);
  assert.equal(isAllowed("worker", "documents", "read"), true);
  assert.equal(isAllowed("worker", "documents", "prepare"), false);
  assert.equal(isAllowed("worker", "files", "write"), false);
  assert.equal(isAllowed("worker", "formats", "validate"), false);
});
