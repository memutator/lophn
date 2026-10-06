import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appHostLabel,
  appPartition,
  createAppSessions,
  createDocumentSessions,
  DOCUMENT_SCHEME,
} from "./session-policy.ts";

function session() {
  let cleared = 0;
  let blocked = false;
  const policy = {
    allowedScheme: DOCUMENT_SCHEME,
    allowedHost: null as string | null,
    blockRequests: () => {
      blocked = true;
    },
    clearStorageData: () => {
      cleared++;
      return Promise.resolve();
    },
  };
  return { policy, cleared: () => cleared, blocked: () => blocked };
}

test("shell/app-frame#R8, shell/app-frame#R1: 문서 session은 partition마다 하나씩 등록하고 같은 partition을 두 번 주지 않는다", () => {
  const sessions = createDocumentSessions();
  const first = session();
  const second = session();
  sessions.register({ session: first.policy, partition: "document-ver_a-s1" });
  sessions.register({ session: second.policy, partition: "document-ver_a-s2" });
  assert.notEqual(
    sessions.find("document-ver_a-s1")?.partition,
    sessions.find("document-ver_a-s2")?.partition,
  );
  assert.throws(() =>
    sessions.register({
      session: session().policy,
      partition: "document-ver_a-s1",
    })
  );
});

test("shell/app-frame#R10: 닫으면 그 session의 저장 상태를 지우고 registry에서 지운다", async () => {
  const sessions = createDocumentSessions();
  const first = session();
  const second = session();
  sessions.register({ session: first.policy, partition: "document-ver_a-s1" });
  sessions.register({ session: second.policy, partition: "document-ver_a-s2" });
  await sessions.close("document-ver_a-s1");
  assert.equal(first.cleared(), 1);
  assert.equal(second.cleared(), 0);
  assert.equal(sessions.find("document-ver_a-s1"), undefined);
  // 닫고 다시 연 판은 앞의 자리를 쓰지 않는다. 같은 partition 재등록이 된다.
  const again = session();
  sessions.register({ session: again.policy, partition: "document-ver_a-s1" });
  assert.equal(
    sessions.find("document-ver_a-s1")?.partition,
    "document-ver_a-s1",
  );
  await sessions.close("missing-partition");
  assert.equal(again.cleared(), 0);
});

test("shell/app-frame#R1, shell/app-frame#R8: 앱 partition은 앱·live·preview bundle로 나뉘고 한 partition에 정책을 한 번만 단다", async () => {
  const app = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
  const hash = "a".repeat(64);
  assert.equal(appPartition(app, "live", hash), `persist:app-${app}:live`);
  assert.equal(
    appPartition(app, "preview", hash),
    `persist:app-${app}:preview-${hash}`,
  );
  assert.notEqual(
    appPartition(app, "preview", hash),
    appPartition(app, "preview", "b".repeat(64)),
  );
  assert.equal(appHostLabel(app), "app-01j9zzzzzzzzzzzzzzzzzzzzzz");
  const handles: string[] = [];
  let prevented = 0;
  let cleared = 0;
  const sessions = createAppSessions({
    handle(partition) {
      handles.push(partition);
      return {
        denyPermissions() {},
        onDownload(listener) {
          listener({ preventDefault: () => prevented++ });
        },
        onBeforeRequest() {},
        onBeforeSendHeaders() {},
        handleProtocol() {},
        clearCache() {
          cleared++;
          return Promise.resolve();
        },
      };
    },
    viewOf: () => undefined,
    protocol: {
      viewFor: () => undefined,
      upstream: () => Promise.reject(new Error("unused")),
      stale() {},
    },
    platformPorts: () => [],
  });
  const live = appPartition(app, "live", hash);
  sessions.ensure(live, appHostLabel(app));
  sessions.ensure(live, appHostLabel(app));
  assert.deepEqual(handles, [live]);
  assert.equal(prevented, 1);
  assert.throws(() => sessions.ensure(live, "app-01j9yyyyyyyyyyyyyyyyyyyyyy"));
  await sessions.clearCache(live);
  await sessions.clearCache("persist:app-other:live");
  assert.equal(cleared, 1);
});
