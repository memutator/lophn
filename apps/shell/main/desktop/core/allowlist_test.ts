import assert from "node:assert/strict";
import { test } from "node:test";

import { ALL_ROUTES } from "../../../../../packages/protocol/mod.ts";

import {
  isAllowed,
  lookupCall,
  READING_WORKER_ROUTES,
  RENDERER_MEMORY_ROUTES,
} from "./allowlist.ts";

test("shell/desktop#R19: renderer allowlist는 contract의 read·command와 문서 읽기 worker만 담는다", () => {
  let reads = 0;
  let commands = 0;
  for (const route of ALL_ROUTES) {
    const allowed = isAllowed(route.kind, route.resource, route.method);
    const name = `${route.kind}:${route.resource}/${route.method}`;
    if (route.kind === "worker" && READING_WORKER_ROUTES.includes(name)) {
      assert.equal(allowed, true, name);
    } else if (
      route.resource === "coding_agent_connections" && route.method === "create"
    ) {
      // 연결 생성은 renderer가 token 검증 hash를 낼 수 없어 allowlist에 없다. 고정 연결 intent로만 만든다.
      assert.equal(allowed, false, name);
    } else if (
      route.kind === "memory" &&
      RENDERER_MEMORY_ROUTES.includes(
        `${route.kind}:${route.resource}/${route.method}`,
      )
    ) {
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

test("documents/versions#R17: 설치 안내 읽기 worker는 통과하고 안내 쓰기는 없다", () => {
  assert.equal(isAllowed("worker", "guides", "list"), true);
  assert.equal(isAllowed("worker", "guides", "get"), true);
  assert.equal(isAllowed("worker", "guides", "outline"), true);
  assert.equal(isAllowed("worker", "guides", "read"), true);
  assert.equal(isAllowed("worker", "guides", "write"), false);
});

test("shell/desktop#R1: documents 화면의 검색 worker는 읽기라 통과하고 준비는 막는다", () => {
  assert.equal(isAllowed("worker", "search", "query"), true);
  assert.equal(isAllowed("worker", "search", "status"), false);
  assert.equal(isAllowed("worker", "documents", "prepare"), false);
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

test("lophn-agent/extensions#R16 #R17 lophn-agent/revert#R15 [agent-I52]: renderer는 MCP 로그인의 시작·완료·상태 읽기·취소와 Summarize from here의 요청·상태 읽기 memory route만 부르고 다른 memory route는 막는다", () => {
  assert.deepEqual(
    [...RENDERER_MEMORY_ROUTES].sort(),
    [
      "memory:agent-mcp-auth/begin",
      "memory:agent-mcp-auth/cancel",
      "memory:agent-mcp-auth/complete",
      "memory:agent-mcp-auth/state",
      "memory:rewind/summary-request",
      "memory:rewind/summary-state",
    ],
  );
  // 요약을 가져가고 끝내는 입구는 runtime(machine)만 쓴다.
  assert.equal(isAllowed("memory", "rewind", "summary-take"), false);
  assert.equal(isAllowed("memory", "rewind", "summary-done"), false);
  for (const method of ["begin", "complete", "state", "cancel"]) {
    assert.equal(isAllowed("memory", "agent-mcp-auth", method), true, method);
  }
  assert.equal(
    lookupCall("memory", "agent-mcp-auth", "begin"),
    "memory:agent-mcp-auth/begin",
  );
  // 앱 단계 이어 실행은 확인 창을 맡은 main이 부른다.
  assert.equal(isAllowed("memory", "rewind", "run-apps"), false);
  assert.equal(
    isAllowed("memory", "coding_agent_connections", "connect"),
    false,
  );
  assert.equal(isAllowed("memory", "apps", "connect"), false);
});
