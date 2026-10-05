import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { WINDOW_SHORTCUTS } from "../../ipc/shortcuts.ts";
import {
  type InputSource,
  type KeyInput,
  listenShortcuts,
  windowShortcut,
} from "./shortcuts.ts";

function key(
  letter: string,
  mods: Partial<Pick<KeyInput, "shift" | "control" | "alt" | "meta">> = {},
  extra: Partial<KeyInput> = {},
): KeyInput {
  return {
    type: "keyDown",
    key: mods.shift ? letter.toUpperCase() : letter,
    code: `Key${letter.toUpperCase()}`,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    ...mods,
    ...extra,
  };
}

test("shell/desktop#R18: 창 안에서 Ctrl+K는 팔레트, Ctrl+Shift+L은 런처 복귀이고 Ctrl+Shift+K는 창 팔레트가 아니다", () => {
  assert.equal(windowShortcut(key("k", { control: true }), "linux"), "palette");
  assert.equal(
    windowShortcut(key("l", { control: true, shift: true }), "win32"),
    "launcher",
  );
  // 전역 팔레트 자리. 창 팔레트·런처 복귀와 다른 동작이라 이 표가 잡지 않는다.
  assert.equal(
    windowShortcut(key("k", { control: true, shift: true }), "linux"),
    null,
  );
  assert.equal(windowShortcut(key("l", { control: true }), "linux"), null);
  assert.equal(
    windowShortcut(key("k", { control: true, alt: true }), "linux"),
    null,
  );
  assert.equal(windowShortcut(key("k"), "linux"), null);
  const values = Object.values(WINDOW_SHORTCUTS);
  assert.equal(new Set(values).size, values.length);
  assert.ok(!values.includes("CommandOrControl+Shift+K" as never));
});

test("shell/desktop#R18: macOS는 Command, 다른 OS는 Control이 CommandOrControl이다", () => {
  assert.equal(windowShortcut(key("k", { meta: true }), "darwin"), "palette");
  assert.equal(windowShortcut(key("k", { control: true }), "darwin"), null);
  assert.equal(windowShortcut(key("k", { meta: true }), "linux"), null);
  assert.equal(
    windowShortcut(key("k", { control: true, meta: true }), "linux"),
    null,
  );
});

test("shell/desktop#R18: 배열이 달라도 물리 글쇠로 맞추고 떼기·눌러 둔 반복은 치지 않는다", () => {
  assert.equal(
    windowShortcut(
      { ...key("k", { control: true }), key: "л", code: "KeyK" },
      "linux",
    ),
    "palette",
  );
  assert.equal(
    windowShortcut(key("k", { control: true }, { type: "keyUp" }), "linux"),
    null,
  );
  assert.equal(
    windowShortcut(
      key("k", { control: true }, { isAutoRepeat: true }),
      "linux",
    ),
    null,
  );
});

function source() {
  let listener:
    | ((event: { preventDefault(): void }, input: KeyInput) => void)
    | undefined;
  const fake: InputSource = {
    on: (_event, next) => {
      listener = next;
    },
  };
  function press(input: KeyInput): boolean {
    let prevented = false;
    listener!({ preventDefault: () => void (prevented = true) }, input);
    return prevented;
  }
  return { fake, press };
}

test("shell/desktop#R18: shell 창이 받은 shortcut만 페이지에서 막고 shell 창이 아닌 곳의 키는 그대로 둔다", () => {
  const delivered: string[] = [];
  const shell = source();
  listenShortcuts(shell.fake, "linux", (shortcut) => {
    delivered.push(shortcut);
    return true;
  });
  assert.equal(shell.press(key("k", { control: true })), true);
  assert.equal(shell.press(key("a", { control: true })), false);
  assert.deepEqual(delivered, ["palette"]);

  // 보호 창 같은 shell 밖 창은 deliver가 받지 않는다고 답한다.
  const other = source();
  listenShortcuts(other.fake, "linux", () => false);
  assert.equal(other.press(key("k", { control: true })), false);
});

test("shell/desktop#R18: main은 전역 단축키를 등록하지 않는다(전역 Ctrl+K를 가로채지 않는다)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(here).filter((name) =>
    name.endsWith(".ts") && !name.endsWith("_test.ts")
  );
  assert.ok(files.includes("main.ts"));
  for (const name of files) {
    const text = readFileSync(join(here, name), "utf8");
    assert.ok(!/globalShortcut/.test(text), `${name} uses globalShortcut`);
  }
});
