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

test("shell/desktop#R19: 대화 도크의 메시지 본문 read와 본문 값을 싣는 보내기는 통과한다", () => {
  // ReadMessageBody는 contract의 read라 따로 열지 않아도 통과한다. 이름이 바뀌면 여기서 안다.
  assert.equal(lookupCall("read", "messages", "body"), "read:messages/body");
  assert.equal(isAllowed("command", "messages", "receive"), true);
  assert.equal(isAllowed("read", "messages", "list"), true);
  assert.equal(isAllowed("worker", "messages", "body"), false);
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

test("shell/desktop#R1: documents 화면의 검색과 saved view 열기 worker는 읽기라 통과하고 준비는 막는다", () => {
  assert.equal(isAllowed("worker", "search", "query"), true);
  assert.equal(isAllowed("worker", "views", "open"), true);
  assert.equal(isAllowed("worker", "search", "status"), false);
  assert.equal(isAllowed("worker", "documents", "prepare"), false);
});

test("shell/desktop#R28: contexts 화면의 Focus 목차 worker는 읽기라 통과하고 context watch는 사람 read로 간다", () => {
  assert.equal(isAllowed("worker", "outline", "context"), true);
  assert.equal(isAllowed("read", "contexts", "watch"), true);
  assert.equal(isAllowed("read", "contexts", "export"), true);
});

test("shell/desktop#R28: projects 화면의 export는 고정 판 읽기라 통과하고 파일 쓰기·지우기는 main 통로로만 간다", () => {
  assert.equal(isAllowed("worker", "documents", "export"), true);
  assert.equal(isAllowed("worker", "files", "write"), false);
  assert.equal(isAllowed("worker", "files", "delete"), false);
});

test("documents/projects#R6: 추적 미리보기 worker는 읽기라 통과하고 추적 적용은 command로만 간다", () => {
  assert.equal(isAllowed("worker", "projects", "preview_tracking"), true);
  assert.equal(isAllowed("command", "projects", "set_tracking"), true);
  assert.equal(isAllowed("command", "projects", "create"), true);
  assert.equal(isAllowed("worker", "files", "watch"), false);
});
