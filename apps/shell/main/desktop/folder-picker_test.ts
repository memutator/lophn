import assert from "node:assert/strict";
import { test } from "node:test";

import { createFolderPicker, type FolderDialog } from "./folder-picker.ts";
import { SHELL_OFF } from "./headless.ts";
import {
  type CallerContents,
  ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

function sender(id: number, url: string): CallerContents {
  return { id, isDestroyed: () => false, mainFrame: { url, parent: null } };
}

function eventOf(contents: CallerContents): IpcEvent {
  return { sender: contents, senderFrame: contents.mainFrame };
}

const desktop = sender(1, "lophn-shell://desktop/index.html");
const overlay = sender(2, "lophn-shell://overlay/index.html");

function registry(): ContentsRegistry {
  const table = new ContentsRegistry();
  table.register({
    contents: desktop,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  table.register({
    contents: overlay,
    origin: { scheme: "lophn-shell", host: "overlay", path: "/index.html" },
  });
  return table;
}

function dialogOf(
  reply: { canceled: boolean; paths: string[] } | Error,
): FolderDialog & { opened: number } {
  const dialog = {
    opened: 0,
    open() {
      dialog.opened += 1;
      return reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve(reply);
    },
  };
  return dialog;
}

test("documents/projects#R1: 폴더는 desktop 창이 연 OS 선택기에서만 고르고 그만두면 null이다", async () => {
  const chosen = dialogOf({ canceled: false, paths: ["/work/notes"] });
  const pick = createFolderPicker({
    registry: registry(),
    dialog: chosen,
    headless: SHELL_OFF,
  });
  assert.deepEqual(await pick(eventOf(desktop), {}), {
    ok: true,
    path: "/work/notes",
  });
  assert.equal(chosen.opened, 1);

  const canceled = createFolderPicker({
    registry: registry(),
    dialog: dialogOf({ canceled: true, paths: [] }),
    headless: SHELL_OFF,
  });
  assert.deepEqual(await canceled(eventOf(desktop), {}), {
    ok: true,
    path: null,
  });

  const relative = createFolderPicker({
    registry: registry(),
    dialog: dialogOf({ canceled: false, paths: ["notes"] }),
    headless: SHELL_OFF,
  });
  assert.deepEqual(await relative(eventOf(desktop), {}), {
    ok: true,
    path: null,
  });
});

test("shell/app-frame#R23: overlay·모르는 sender와 모르는 입력은 선택기를 열지 않는다", async () => {
  const dialog = dialogOf({ canceled: false, paths: ["/work"] });
  const pick = createFolderPicker({
    registry: registry(),
    dialog,
    headless: SHELL_OFF,
  });
  assert.deepEqual(await pick(eventOf(overlay), {}), {
    ok: false,
    code: "forbidden",
  });
  assert.deepEqual(
    await pick(eventOf(sender(9, "lophn-shell://desktop/index.html")), {}),
    { ok: false, code: "forbidden" },
  );
  assert.deepEqual(await pick(eventOf(desktop), { path: "/etc" }), {
    ok: false,
    code: "invalid_input",
  });
  assert.equal(dialog.opened, 0);

  const broken = createFolderPicker({
    registry: registry(),
    dialog: dialogOf(new Error("no display")),
    headless: SHELL_OFF,
  });
  assert.deepEqual(await broken(eventOf(desktop), {}), {
    ok: false,
    code: "unavailable",
  });
});

test("shell/desktop#R11: headless는 사람 화면에 dialog를 띄우지 않고 준 폴더만 돌려준다", async () => {
  const dialog = dialogOf({ canceled: false, paths: ["/elsewhere"] });
  const pick = createFolderPicker({
    registry: registry(),
    dialog,
    headless: { headless: true },
    headlessPick: "/tmp/lophn-pick",
  });
  assert.deepEqual(await pick(eventOf(desktop), {}), {
    ok: true,
    path: "/tmp/lophn-pick",
  });
  const none = createFolderPicker({
    registry: registry(),
    dialog,
    headless: { headless: true },
  });
  assert.deepEqual(await none(eventOf(desktop), {}), { ok: true, path: null });
  assert.equal(dialog.opened, 0);
});
