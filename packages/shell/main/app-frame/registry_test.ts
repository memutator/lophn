import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreCaller } from "./app-connection.ts";
import type { ViewHealthSignal } from "./crash.ts";
import { createViewDiagnostics } from "./diagnostics.ts";
import { createAppFrame } from "./registry.ts";
import type { AppViewContents } from "./view-model.ts";

const APP = "app_00000000000000000000000001";
const RELEASE = "rel_00000000000000000000000001";
const HASH = "a".repeat(64);
const WINDOW = "window-1";
const OTHER = "window-2";
const OPEN = {
  app: APP,
  mode: "live",
  release: RELEASE,
  screen: "panel",
  place: "tab",
} as const;

// fake core의 view 표. open은 받은 release에 묶고, params는 core가 정규화한 값(기본값 `page: 1`을 채운다)을 돌려준다.
// 받은 요청은 `calls`에 남는다.
function fakeCore() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const call: CoreCaller = async (_kind, resource, method, body) => {
    assert.equal(resource, "app_views");
    const input = body as Record<string, unknown>;
    calls.push({ method, body: input });
    if (method === "close") return { ok: true, value: { closed: true } };
    const params = input.params as Record<string, unknown> | undefined;
    return {
      ok: true,
      value: {
        view: input.view,
        release: input.release ?? RELEASE,
        bundle_hash: HASH,
        process_nonce: "nonce",
        params: params === undefined ? null : { ...params, page: 1 },
      },
    };
  };
  return { call, calls };
}

// fake 창·guest. guest id는 실제 Electron처럼 그 webContents id를 그대로 쓴다.
function createFrame() {
  let contentsId = 0;
  const health = new Map<number, (signal: ViewHealthSignal) => void>();
  const destroyed = new Map<number, () => void>();
  const core = fakeCore();
  const frame = createAppFrame({
    call: core.call,
    connector: {
      async hosts() {
        return { ok: true as const, value: [] };
      },
    },
    views: {
      hasWindow: (window) => window === WINDOW || window === OTHER,
      guest(guest, rules) {
        health.set(guest.id, (signal) => rules.onHealth?.(signal));
        destroyed.set(guest.id, rules.onDestroyed);
        return {
          id: guest.id,
          async capture() {
            return new Uint8Array();
          },
          pageUrl: () => null,
          send() {},
        } satisfies AppViewContents;
      },
    },
    sessionHandle: () => ({
      denyPermissions() {},
      onDownload() {},
      onBeforeRequest() {},
      onBeforeSendHeaders() {},
      handleProtocol() {},
      async clearCache() {},
    }),
    upstream: async () => ({ status: 200, headers: {}, body: null }),
    platformPorts: () => [],
    diagnostics: createViewDiagnostics({
      send: () => true,
      log: () => {},
      clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    }),
    ids: {
      viewSession: () => `view-${++contentsId}`,
      token: () => `token-${contentsId}`,
    },
    clock: { nowMs: () => 0 },
  });
  return { frame, health, destroyed, calls: core.calls };
}

test("open은 src를 내고, acceptGuest는 그 창의 그 src만 한 번 받는다", async () => {
  const { frame } = createFrame();
  const opened = await frame.open(WINDOW, OPEN);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const { src, view_session } = opened.value;
  assert.match(
    src,
    /^lophn-app:\/\/app-[0-9a-z]+\/panel\/index\.html\?view_session=view-\d+&place=tab&mount=1$/,
  );
  assert.equal(frame.owner(view_session), WINDOW);

  // 다른 창·모르는 src는 받지 않는다.
  assert.equal(frame.acceptGuest(OTHER, src), undefined);
  assert.equal(
    frame.acceptGuest(WINDOW, src.replace("mount=1", "mount=2")),
    undefined,
  );

  const accepted = frame.acceptGuest(WINDOW, src);
  assert.ok(accepted !== undefined);
  assert.equal(accepted.src, src);
  assert.match(accepted.partition, /^persist:app-app_[0-9a-z]+:live$/);
  // 같은 src는 한 번만 쓴다.
  assert.equal(frame.acceptGuest(WINDOW, src), undefined);
});

test("bindGuest는 guest id로 신원을 묶고, guest가 사라지면 푼다", async () => {
  const { frame, destroyed } = createFrame();
  const opened = await frame.open(WINDOW, OPEN);
  if (!opened.ok) return assert.fail("view did not open");
  const accepted = frame.acceptGuest(WINDOW, opened.value.src);
  assert.ok(accepted !== undefined);
  frame.bindGuest(accepted, { id: 7 });
  assert.equal(frame.senderView(7)?.view_session, opened.value.view_session);
  assert.equal(
    frame.senderAnnotateView(7)?.view_session,
    opened.value.view_session,
  );
  destroyed.get(7)?.();
  assert.equal(frame.senderView(7), undefined);
  assert.equal(frame.senderAnnotateView(7), undefined);
  // entry는 닫을 때까지 남는다.
  assert.equal(frame.owner(opened.value.view_session), WINDOW);
});

test("crash 뒤 reopen은 새 src·세대를 내고 옛 guest 신원을 버린다", async () => {
  const { frame, health } = createFrame();
  const opened = await frame.open(WINDOW, OPEN);
  if (!opened.ok) return assert.fail("view did not open");
  const { view_session, src } = opened.value;
  const accepted = frame.acceptGuest(WINDOW, src);
  assert.ok(accepted !== undefined);
  frame.bindGuest(accepted, { id: 7 });

  // 건강한 view는 다시 열지 않는다.
  const healthy = frame.reopen(WINDOW, view_session);
  assert.equal(healthy.ok, false);

  health.get(7)?.("gone");
  assert.equal(frame.state(view_session)?.viewHealth, "crashed");

  const reopened = frame.reopen(WINDOW, view_session);
  assert.equal(reopened.ok, true);
  if (!reopened.ok) return;
  assert.match(reopened.value.src, /&mount=2$/);
  assert.equal(reopened.value.viewHealth, "ok");
  // 옛 guest의 요청·신원은 새 화면이 열리는 순간 사라진다.
  assert.equal(frame.senderView(7), undefined);
  assert.equal(frame.acceptGuest(WINDOW, src), undefined);
  assert.ok(frame.acceptGuest(WINDOW, reopened.value.src) !== undefined);
});

test("다른 창은 이 창의 view를 닫거나 다시 열지 못하고, 창을 닫으면 core의 view도 닫는다", async () => {
  const { frame, calls } = createFrame();
  const opened = await frame.open(WINDOW, OPEN);
  if (!opened.ok) return assert.fail("view did not open");
  assert.equal(frame.reopen(OTHER, opened.value.view_session).ok, false);
  assert.equal(frame.state(opened.value.view_session)?.src, opened.value.src);
  frame.closeWindow(WINDOW);
  assert.equal(frame.owner(opened.value.view_session), undefined);
  assert.deepEqual(calls.at(-1), {
    method: "close",
    body: { view: opened.value.view_session },
  });
});

test("core가 정규화한 params만 화면 주소로 간다", async () => {
  const { frame, calls } = createFrame();
  const opened = await frame.open(WINDOW, {
    ...OPEN,
    params: { status: "open" },
    workspace: { kind: "project", id: "prj_1", folders: ["/work/a"] },
  });
  if (!opened.ok) return assert.fail("view did not open");
  // core에는 shell이 정한 view id와 받은 인자를 그대로 보낸다.
  assert.deepEqual(calls[0], {
    method: "open",
    body: {
      view: opened.value.view_session,
      ...OPEN,
      params: { status: "open" },
      workspace: { kind: "project", id: "prj_1", folders: ["/work/a"] },
    },
  });
  const query = new URL(opened.value.src).searchParams;
  assert.equal(query.get("place"), "tab");
  assert.deepEqual(JSON.parse(query.get("params") ?? ""), {
    status: "open",
    page: 1,
  });
  assert.deepEqual(JSON.parse(query.get("workspace") ?? ""), {
    kind: "project",
    id: "prj_1",
    folders: ["/work/a"],
  });
});
