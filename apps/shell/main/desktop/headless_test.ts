import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  capturePaints,
  guardNotifier,
  guardShortcuts,
  type PaintImage,
  readHeadless,
  reveal,
  SETTLE_MS,
  SHELL_OFF,
  surfaceOptions,
} from "./headless.ts";
import { windowConfig } from "./window.ts";
import type { GlobalShortcutPort } from "./global-shortcut.ts";
import { installGlobalPalette } from "./global-shortcut.ts";
import type { OsNotifier } from "./os-notification.ts";
import { createOsNotifications } from "./os-notification.ts";
import { confirmationConfig } from "../confirmation/window.ts";

const desktop = () =>
  windowConfig({
    platform: "linux",
    packaged: true,
    preload: "/dist/preload-shell.cjs",
  });

test("shell/desktop#R11: 변수가 없으면 창 옵션을 그대로 두고 show·focus를 그대로 부른다", () => {
  const mode = readHeadless({ LOPHN_SHELL_SHOT_DIR: "/tmp/shots" });
  assert.deepEqual(mode, SHELL_OFF);
  const config = desktop();
  const out = surfaceOptions(config, mode);
  assert.equal(out, config);
  assert.equal("show" in out, false);
  assert.equal("offscreen" in out.webPreferences, false);
  assert.deepEqual(readHeadless({ LOPHN_SHELL_HEADLESS: "true" }), SHELL_OFF);

  const calls: string[] = [];
  reveal({
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
    isMinimized: () => true,
    restore: () => calls.push("restore"),
  }, mode);
  assert.deepEqual(calls, ["restore", "show", "focus"]);
});

test("shell/desktop#R11: LOPHN_SHELL_HEADLESS=1이면 창·view·보호 창이 offscreen이고 보이지 않는다", () => {
  const mode = readHeadless({
    LOPHN_SHELL_HEADLESS: "1",
    LOPHN_SHELL_SHOT_DIR: "/tmp/shots",
  });
  assert.deepEqual(mode, { headless: true, shotDir: "/tmp/shots" });

  const config = desktop();
  const out = surfaceOptions(config, mode) as typeof config & {
    show: boolean;
    webPreferences: { offscreen: boolean };
  };
  assert.equal(out.show, false);
  assert.equal(out.webPreferences.offscreen, true);
  // 격리 기본값은 그대로 남는다(shell/desktop#R16).
  assert.equal(out.webPreferences.sandbox, true);
  assert.equal(out.webPreferences.contextIsolation, true);
  assert.equal(out.webPreferences.preload, "/dist/preload-shell.cjs");
  assert.equal("offscreen" in config.webPreferences, false);

  const view = surfaceOptions(
    { webPreferences: { preload: "/dist/preload-shell.cjs" } },
    mode,
  ) as unknown as { show: boolean; webPreferences: { offscreen: boolean } };
  assert.equal(view.show, false);
  assert.equal(view.webPreferences.offscreen, true);

  const confirmation = confirmationConfig({
    parent: {
      id: "w1",
      focus: () => {},
      getContentSize: () => ({ width: 960, height: 600 }),
    },
    preload: "/dist/preload-confirmation.cjs",
    packaged: true,
    partition: "confirmation-cfw_1",
    headless: mode,
  }) as ReturnType<typeof confirmationConfig> & {
    webPreferences: { offscreen: boolean };
  };
  assert.equal(confirmation.show, false);
  assert.equal(confirmation.webPreferences.offscreen, true);
  assert.equal(confirmation.webPreferences.partition, "confirmation-cfw_1");

  const calls: string[] = [];
  reveal({
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  }, mode);
  assert.deepEqual(calls, []);
});

test("shell/desktop#R11: shot dir이 있으면 첫 비지 않은 paint와 안정된 뒤 paint를 PNG로 쓴다", () => {
  const writes: [string, string][] = [];
  const timers = new Map<number, () => void>();
  let next = 0;
  let listener:
    | ((event: unknown, dirty: unknown, image: PaintImage) => void)
    | undefined;
  const image = (text: string, empty = false): PaintImage => ({
    isEmpty: () => empty,
    toPNG: () => new TextEncoder().encode(text),
  });
  capturePaints(
    { on: (_event, handler) => void (listener = handler) },
    "window-1",
    { headless: true, shotDir: "/shots" },
    {
      write: (path, data) =>
        writes.push([path, new TextDecoder().decode(data)]),
      timer: {
        set: (callback, ms) => {
          assert.equal(ms, SETTLE_MS);
          timers.set(++next, callback);
          return next;
        },
        clear: (handle) => timers.delete(handle as number),
      },
    },
  );
  listener!({}, {}, image("", true));
  assert.deepEqual(writes, []);
  listener!({}, {}, image("a"));
  listener!({}, {}, image("b"));
  assert.deepEqual(writes, [["/shots/window-1-first.png", "a"]]);
  assert.equal(timers.size, 1);
  [...timers.values()][0]!();
  assert.deepEqual(writes.at(-1), ["/shots/window-1-settled.png", "b"]);

  let hooked = false;
  capturePaints(
    { on: () => void (hooked = true) },
    "window-2",
    { headless: true },
    { write: () => {}, timer: { set: () => 0, clear: () => {} } },
  );
  capturePaints(
    { on: () => void (hooked = true) },
    "window-3",
    SHELL_OFF,
    { write: () => {}, timer: { set: () => 0, clear: () => {} } },
  );
  assert.equal(hooked, false);
});

test("shell/desktop#R16: preload는 env를 읽지 않아 headless 값이 renderer에 닿지 않는다", () => {
  const preload = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../preload",
  );
  for (const file of readdirSync(preload).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(preload, file), "utf8");
    assert.equal(/process\.env|LOPHN_SHELL_/.test(text), false, file);
  }
});

// 실제 OS adapter 자리. headless에서 불리면 test가 실패한다.
function realOs(calls: string[]) {
  const shortcuts: GlobalShortcutPort = {
    register: (accelerator) => {
      calls.push(`register ${accelerator}`);
      return true;
    },
    unregister: (accelerator) => void calls.push(`unregister ${accelerator}`),
  };
  const notifier: OsNotifier = {
    isSupported: () => true,
    show: (note) => void calls.push(`show ${note.title}`),
  };
  return { shortcuts, notifier };
}

test("shell/desktop#R18: headless는 OS 전역 단축키를 등록하지 않고 전역 팔레트는 사용 불가다", () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const os = realOs(calls);
  const palette = installGlobalPalette({
    port: guardShortcuts(os.shortcuts, { headless: true }, (m) => logs.push(m)),
    onPalette: () => assert.fail("not registered"),
    log: () => {},
  });
  palette.dispose();
  assert.equal(palette.state, "unavailable");
  assert.deepEqual(calls, []);
  assert.ok(logs.some((line) => line.includes("not registered")));
  // 변수가 없으면 실제 adapter 그대로다.
  assert.equal(guardShortcuts(os.shortcuts, SHELL_OFF, () => {}), os.shortcuts);
});

test("shell/desktop#R10: headless는 OS notification을 올리지 않고 log만 남긴다", async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const os = realOs(calls);
  const notifications = createOsNotifications({
    notifier: guardNotifier(
      os.notifier,
      { headless: true },
      (m) => logs.push(m),
    ),
    optedIn: () => Promise.resolve(true),
    open: () => assert.fail("no click in headless"),
    log: () => {},
  });
  await notifications.arrived([{
    type: "NotificationCreated",
    subject: "ntf_a",
  }]);
  assert.deepEqual(calls, []);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.includes("ntf_a"), false);
  assert.equal(guardNotifier(os.notifier, SHELL_OFF, () => {}), os.notifier);
});
