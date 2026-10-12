import assert from "node:assert/strict";
import { test } from "node:test";

import { en } from "../../../design/wording/en.ts";
import type { AutostartState } from "./autostart.ts";
import {
  installTray,
  type TrayActions,
  type TrayHandle,
  trayIconPath,
  type TrayItemId,
  trayMenu,
  type TrayMenuItem,
} from "./tray.ts";

function fakeTray() {
  const menus: TrayMenuItem[][] = [];
  let select: (id: TrayItemId) => void = () => {};
  let click: () => void = () => {};
  let tooltip = "";
  let destroyed = false;
  const handle: TrayHandle = {
    setToolTip: (text) => void (tooltip = text),
    setMenu: (items, onSelect) => {
      menus.push(items);
      select = onSelect;
    },
    onClick: (handler) => void (click = handler),
    destroy: () => void (destroyed = true),
  };
  return {
    handle,
    menus,
    select: (id: TrayItemId) => select(id),
    click: () => click(),
    tooltip: () => tooltip,
    destroyed: () => destroyed,
  };
}

function fakeActions(initial: AutostartState = {
  available: true,
  enabled: false,
}) {
  const calls: string[] = [];
  let autostart = initial;
  const actions: TrayActions = {
    openWindow: () => void calls.push("open"),
    openLauncher: () => void calls.push("launcher"),
    readAutostart: () => autostart,
    writeAutostart: (enabled) => {
      calls.push(`autostart:${enabled}`);
      autostart = { available: true, enabled };
      return autostart;
    },
    quit: () => void calls.push("quit"),
  };
  return { actions, calls };
}

function labels(items: TrayMenuItem[]): string[] {
  return items.map((item) => item.type === "separator" ? "-" : item.label);
}

test("shell/desktop#R11: tray menu는 창 열기·런처·자동 시작·Quit을 catalog 문구로 둔다", () => {
  const items = trayMenu({ available: true, enabled: false });
  assert.deepEqual(labels(items), [
    en["common.label.tray-open"],
    en["common.label.tray-launcher"],
    "-",
    en["common.label.tray-start-at-login"],
    "-",
    en["common.label.tray-quit"],
  ]);
  assert.deepEqual(labels(items), [
    "Open lophn",
    "Launcher",
    "-",
    "Start at login",
    "-",
    "Quit lophn",
  ]);
});

test("shell/desktop#R11: tray 항목은 각 행동으로만 이어진다", () => {
  const tray = fakeTray();
  const { actions, calls } = fakeActions();
  const installed = installTray({
    factory: { create: () => tray.handle },
    icon: "/fixture/icon.png",
    actions,
  });
  assert.ok(installed);
  assert.equal(tray.tooltip(), "lophn");
  tray.select("open");
  tray.select("launcher");
  tray.click();
  tray.select("quit");
  assert.deepEqual(calls, ["open", "launcher", "open", "quit"]);
  installed.destroy();
  assert.equal(tray.destroyed(), true);
});

test("shell/desktop#R21: tray의 자동 시작 항목은 OS에서 다시 읽은 상태로 다시 그린다", () => {
  const tray = fakeTray();
  const { actions, calls } = fakeActions();
  installTray({
    factory: { create: () => tray.handle },
    icon: "/fixture/icon.png",
    actions,
  });
  const checkbox = (items: TrayMenuItem[]) =>
    items.find((item) => item.type === "checkbox");
  assert.equal(checkbox(tray.menus.at(-1)!)?.checked, false);
  tray.select("autostart");
  assert.equal(checkbox(tray.menus.at(-1)!)?.checked, true);
  tray.select("autostart");
  assert.equal(checkbox(tray.menus.at(-1)!)?.checked, false);
  assert.deepEqual(calls, ["autostart:true", "autostart:false"]);
});

test("shell/desktop#R21: 자동 시작을 쓸 수 없는 실행은 그 항목을 끈 채 보인다", () => {
  const items = trayMenu({
    available: false,
    enabled: false,
    reason: "not_packaged",
  });
  const checkbox = items.find((item) => item.type === "checkbox");
  assert.equal(checkbox?.type === "checkbox" && checkbox.enabled, false);
  assert.equal(checkbox?.type === "checkbox" && checkbox.checked, false);
});

test("shell/desktop#R18: 쓸 수 없게 된 전역 팔레트·OS notification은 Quit 위에 누를 수 없는 안내 줄로 한 번씩 보인다", () => {
  const tray = fakeTray();
  const { actions, calls } = fakeActions();
  const installed = installTray({
    factory: { create: () => tray.handle },
    icon: "/fixture/icon.png",
    actions,
  })!;
  installed.notice("global-search-unavailable");
  installed.notice("notifications-unavailable");
  installed.notice("global-search-unavailable");
  const menu = tray.menus.at(-1)!;
  assert.equal(tray.menus.length, 3);
  assert.deepEqual(labels(menu).slice(-4), [
    en["common.label.tray-global-search-unavailable"],
    en["common.label.tray-notifications-unavailable"],
    "-",
    en["common.label.tray-quit"],
  ]);
  // 안내 줄은 id가 없어 어떤 행동으로도 이어지지 않는다.
  const notices = menu.filter((item) => item.type === "notice");
  assert.equal(notices.length, 2);
  assert.ok(notices.every((item) => !("id" in item)));
  assert.deepEqual(calls, []);
  // 안내가 없으면 menu는 그대로다.
  assert.equal(
    trayMenu({ available: true, enabled: false }).some((item) =>
      item.type === "notice"
    ),
    false,
  );
});

test("shell/desktop#R11: tray를 띄우지 못하면 log만 남기고 main은 계속된다", () => {
  const logs: string[] = [];
  const { actions, calls } = fakeActions();
  const installed = installTray({
    factory: {
      create: () => {
        throw new Error("no status area");
      },
    },
    icon: "/fixture/icon.png",
    actions,
    log: (message) => logs.push(message),
  });
  assert.equal(installed, undefined);
  assert.equal(logs.length, 1);
  assert.ok(logs[0]!.includes("no status area"));
  assert.deepEqual(calls, []);
});

test("shell/desktop#R11: tray 아이콘은 packaged는 resources, 개발 실행은 desktop 폴더에서 읽는다", () => {
  assert.equal(
    trayIconPath({
      packaged: true,
      resourcesPath: "/opt/lophn/resources",
      desktopDir: "/repo/apps/shell/main/desktop",
    }),
    "/opt/lophn/resources/icon.png",
  );
  assert.equal(
    trayIconPath({
      packaged: false,
      resourcesPath: "/opt/lophn/resources",
      desktopDir: "/repo/apps/shell/main/desktop",
    }),
    "/repo/apps/shell/main/desktop/icon.png",
  );
});
