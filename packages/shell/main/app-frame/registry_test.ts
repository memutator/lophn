import assert from "node:assert/strict";
import { test } from "node:test";

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
  size: "full",
} as const;

// fake 창·guest. guest id는 실제 Electron처럼 그 webContents id를 그대로 쓴다.
function createFrame() {
  let contentsId = 0;
  const health = new Map<number, (signal: ViewHealthSignal) => void>();
  const destroyed = new Map<number, () => void>();
  const frame = createAppFrame({
    connector: {
      async connect(target) {
        return {
          ok: true as const,
          value: {
            release: target.release ?? RELEASE,
            bundleHash: HASH,
            processNonce: "nonce",
          },
        };
      },
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
  return { frame, health, destroyed };
}

test("open은 src를 내고, acceptGuest는 그 창의 그 src만 한 번 받는다", async () => {
  const { frame } = createFrame();
  const opened = await frame.open(WINDOW, OPEN);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const { src, view_session } = opened.value;
  assert.match(
    src,
    /^lophn-app:\/\/app-[0-9a-z]+\/panel\/index\.html\?view_session=view-\d+&mount=1$/,
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

test("다른 창은 이 창의 view를 닫거나 다시 열지 못한다", async () => {
  const { frame } = createFrame();
  const opened = await frame.open(WINDOW, OPEN);
  if (!opened.ok) return assert.fail("view did not open");
  assert.equal(frame.reopen(OTHER, opened.value.view_session).ok, false);
  assert.equal(frame.state(opened.value.view_session)?.src, opened.value.src);
  frame.closeWindow(WINDOW);
  assert.equal(frame.owner(opened.value.view_session), undefined);
});
