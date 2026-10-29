import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createKeybindingService,
  type KeyEventLike,
  type KeyTarget,
} from "./keybinding-service.ts";
import { createCommandRegistry } from "./registry.ts";

function setup() {
  const logged: string[] = [];
  const registry = createCommandRegistry({
    log: (message) => logged.push(message),
  });
  const keybindings = createKeybindingService({
    registry,
    platform: "other",
    inShell: (target) => target === "terminal",
    ignores: (target) => target === "capture",
  });
  return { registry, keybindings, logged };
}

function press(
  code: string,
  mods: { ctrl?: boolean; shift?: boolean } = {},
  extra: Partial<KeyEventLike> = {},
) {
  const seen = { prevented: false };
  const event: KeyEventLike = {
    key: "",
    code,
    ctrlKey: mods.ctrl ?? false,
    metaKey: false,
    altKey: false,
    shiftKey: mods.shift ?? false,
    repeat: false,
    isComposing: false,
    target: null,
    preventDefault: () => void (seen.prevented = true),
    stopPropagation: () => {},
    ...extra,
  };
  return { event, seen };
}

test("같은 command id는 나중 주인이 받고, 그것을 풀면 앞 주인이 다시 받으며 다 풀면 not_found다", () => {
  const { registry } = setup();
  const ran: string[] = [];
  const first = registry.register("tab.close", () => ran.push("first"));
  const second = registry.register("tab.close", () => ran.push("second"));
  registry.execute("tab.close");
  second.dispose();
  second.dispose();
  registry.execute("tab.close");
  first.dispose();
  assert.deepStrictEqual(ran, ["second", "first"]);
  assert.deepStrictEqual(registry.execute("tab.close").ok, false);
  const missing = registry.execute("tab.close");
  assert.deepStrictEqual(missing.ok ? null : missing.error.code, "not_found");
});

test("handler가 던지면 internal로 돌리고 다음 키는 그대로 받는다", () => {
  const { registry, keybindings, logged } = setup();
  let saved = 0;
  registry.register("editor.save", () => {
    throw new Error("boom");
  });
  registry.register("explorer.refresh", () => saved++);
  keybindings.register({
    command: "editor.save",
    other: ["Ctrl+KeyS"],
    mac: [],
  });
  keybindings.register({
    command: "explorer.refresh",
    other: ["Ctrl+KeyR"],
    mac: [],
  });
  const result = registry.execute("editor.save");
  assert.deepStrictEqual(result.ok ? null : result.error.code, "internal");
  assert.deepStrictEqual(
    keybindings.handle(press("KeyS", { ctrl: true }).event),
    true,
  );
  assert.deepStrictEqual(
    keybindings.handle(press("KeyR", { ctrl: true }).event),
    true,
  );
  assert.deepStrictEqual(saved, 1);
  assert.deepStrictEqual(logged.length, 2);
});

test("같은 키는 나중 바인딩부터 보고 부를 수 없는 command는 건너뛰며 아무도 못 받으면 키를 넘긴다", () => {
  const { registry, keybindings } = setup();
  const ran: string[] = [];
  let editorFocused = true;
  registry.register("files.quick-open", () => ran.push("palette"));
  registry.register("editor.go-to", () => ran.push("editor"), {
    when: () => editorFocused,
  });
  keybindings.register({
    command: "files.quick-open",
    other: ["Ctrl+KeyP"],
    mac: [],
  });
  const local = keybindings.register({
    command: "editor.go-to",
    other: ["Ctrl+KeyP"],
    mac: [],
  });
  keybindings.handle(press("KeyP", { ctrl: true }).event);
  editorFocused = false;
  keybindings.handle(press("KeyP", { ctrl: true }).event);
  editorFocused = true;
  local.dispose();
  keybindings.handle(press("KeyP", { ctrl: true }).event);
  assert.deepStrictEqual(ran, ["editor", "palette", "palette"]);

  // 주인이 없는 바인딩과 표에 없는 키는 preventDefault 하지 않는다.
  keybindings.register({ command: "nobody", other: ["Ctrl+KeyJ"], mac: [] });
  for (const code of ["KeyJ", "KeyY"]) {
    const { event, seen } = press(code, { ctrl: true });
    assert.deepStrictEqual(keybindings.handle(event), false, code);
    assert.deepStrictEqual(seen.prevented, false, code);
  }
});

test("조합 중·터미널의 Ctrl+글자는 넘기고 눌러 둔 반복은 삼키기만 한다", () => {
  const { registry, keybindings } = setup();
  let closed = 0;
  registry.register("tab.close", () => closed++);
  keybindings.register({ command: "tab.close", other: ["Ctrl+KeyW"], mac: [] });
  const composing = press("KeyW", { ctrl: true }, { isComposing: true });
  const terminal = press("KeyW", { ctrl: true }, { target: "terminal" });
  const repeat = press("KeyW", { ctrl: true }, { repeat: true });
  assert.deepStrictEqual(keybindings.handle(composing.event), false);
  assert.deepStrictEqual(keybindings.handle(terminal.event), false);
  assert.deepStrictEqual(terminal.seen.prevented, false);
  assert.deepStrictEqual(keybindings.handle(repeat.event), true);
  assert.deepStrictEqual(repeat.seen.prevented, true);
  assert.deepStrictEqual(closed, 0);
});

test("같은 target을 여러 번 들어도 listener는 하나이고 마지막 dispose에서 뗀다", () => {
  const { keybindings } = setup();
  const attached = new Set<unknown>();
  let adds = 0;
  const target: KeyTarget = {
    addEventListener: (_type, listener) => {
      adds++;
      attached.add(listener);
    },
    removeEventListener: (_type, listener) => void attached.delete(listener),
  };
  const a = keybindings.listen(target);
  const b = keybindings.listen(target);
  a.dispose();
  a.dispose();
  assert.deepStrictEqual([adds, attached.size], [1, 1]);
  b.dispose();
  assert.deepStrictEqual(attached.size, 0);
});
