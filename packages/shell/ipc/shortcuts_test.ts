import assert from "node:assert/strict";
import { test } from "node:test";

import { appPanelBindingId } from "../../protocol/shell/keybindings.ts";
import { isWindowShortcut } from "./shortcuts.ts";

test("isWindowShortcut은 팔레트·Home·표의 binding id·동적 id·app.panel id를 받고 모르는 글자는 거절한다", () => {
  for (const ok of [
    "palette.open",
    "home.open",
    "tab.close",
    "desk.nth:3",
    "agent.send",
    "ext.harness-gui.rewind",
    "app.app_x.save",
    appPanelBindingId("app_x", "main"),
  ]) {
    assert.deepStrictEqual(isWindowShortcut(ok), true, ok);
  }
  for (const bad of [
    "desk.nth:10",
    "tab.bogus",
    "app.panel",
    "app.panel:a",
    "ext.bad",
    3,
    null,
  ]) {
    assert.deepStrictEqual(isWindowShortcut(bad), false, String(bad));
  }
});
