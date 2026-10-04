import assert from "node:assert/strict";
import { test } from "node:test";

import { createCoordinator } from "./coordinator.ts";
import type { CoreHandlePort } from "./handle.ts";
import type { AppContents, ConfirmationHost, ParentWindow } from "./window.ts";

// 실제 Electron harness(e2e/shell)는 아직 없다. 이 테스트는 그 확인이 볼
// 경계만 가짜 host로 고정한다: 부모 앱 view는 보이고 입력은 막히며,
// 창 밖 동의 통로는 coordinator에 없다.

test("shell/confirmation-window#R6: 부모 앱 view가 보이지만 click·키 입력을 받지 않는다", async () => {
  const clicks: string[] = [];
  const keys: string[] = [];
  const app: AppContents & { visible: boolean } = {
    id: 1,
    visible: true,
    isDestroyed: () => false,
    on: (_event, listener) => {
      keys.push("blocked");
      listener({ preventDefault() {} });
    },
    off: () => {},
    setWindowOpenHandler: () => {},
  };
  const host: ConfirmationHost = {
    create: () => ({
      webContents: {
        id: 2,
        loadURL: () => Promise.resolve(),
        send: () => {},
        isDestroyed: () => false,
        on: () => {},
        setWindowOpenHandler: () => {},
        close: () => {},
      },
      loadURL: () => Promise.resolve(),
      show: () => {},
      focus: () => {},
      close: () => {},
      isDestroyed: () => false,
      on: () => {},
    }),
    sessionFor: () => ({
      partition: "confirmation-1",
      setPermissionRequestHandler: () => {},
      on: () => {},
      webRequest: { onBeforeRequest: () => {} },
    }),
    appContents: () => [app],
  };
  const handles: CoreHandlePort = {
    register: (request) =>
      Promise.resolve({
        ok: true,
        confirmation: "D".repeat(43),
        expiresAt: request.expires_at,
      }),
    closeWindow: () => Promise.resolve(),
    clear: () => Promise.resolve(),
  };
  const parent: ParentWindow = {
    id: "parent",
    focus: () => {},
    getContentSize: () => ({ width: 1000, height: 700 }),
  };
  const confirm = createCoordinator({
    host,
    canon: {
      read: () =>
        Promise.resolve({
          ok: true,
          value: {
            targetRef: "apr_00000000000000000000000001",
            content: {
              approval: "apr_00000000000000000000000001",
              binding_hash: "a".repeat(64),
              created_seq: "1",
            },
            allowed: ["grant_approval_request"],
            expiresAt: null,
            secondConfirm: false,
            display: { titleKey: "t", bodyKey: "b" },
          },
        }),
    },
    handles,
    submit: {
      submit: () => Promise.resolve({ ok: false, unknown: true }),
      receipt: () => Promise.resolve(undefined),
    },
    clock: { now: () => Date.now() },
    preload: "/preload-confirmation.cjs",
    packaged: false,
    epoch: () => "e",
    connected: () => true,
  });
  await confirm.open({
    intent: {
      kind: "approval_request",
      approval: "apr_00000000000000000000000001",
    },
    parent,
    requestedByPerson: true,
  });
  clicks.push("app-click");
  assert.equal(app.visible, true);
  assert.deepEqual(keys, ["blocked"]);
  assert.equal(
    Object.hasOwn(confirm, "acceptCli"),
    false,
  );
  assert.equal(Object.hasOwn(confirm, "acceptMcp"), false);
});

test("shell/confirmation-window#R1: CLI·MCP 동의 메서드는 결정 통로가 아니다", () => {
  const source = createCoordinator.toString();
  assert.equal(/cli|mcp|tty/i.test(source), false);
});
