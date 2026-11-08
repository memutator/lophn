import assert from "node:assert/strict";
import { test } from "node:test";

import type { KeyPlatform } from "../../ipc/keybindings.ts";
import { shellOwns } from "../../ipc/keybindings.ts";
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
  const timers: { run: () => void; canceled: boolean }[] = [];
  const keybindings = createKeybindingService({
    registry,
    platform: "other" as KeyPlatform,
    // 테스트는 target에 context 이름 배열을 그대로 준다(DOM walk 대신).
    contexts: (target) => (Array.isArray(target) ? target : ["global"]),
    ignores: (target) => target === "capture",
    setTimer: (run, _ms) => {
      const entry = { run, canceled: false };
      timers.push(entry);
      return () => {
        entry.canceled = true;
      };
    },
  });
  const fireTimer = () => {
    const waiting = timers.filter((entry) => !entry.canceled);
    waiting.at(-1)?.run();
  };
  return { registry, keybindings, logged, timers, fireTimer };
}

function press(
  code: string,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
  extra: Partial<KeyEventLike> = {},
) {
  const seen = { prevented: false };
  const event: KeyEventLike = {
    key: "",
    code,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    altKey: mods.alt ?? false,
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

test("안쪽 context가 먼저 듣고, 한 context 안에서는 사용자 > 기여 > 표 순서이며 부를 수 없는 것은 건너뛴다", () => {
  const { registry, keybindings } = setup();
  const ran: string[] = [];
  for (const command of ["inner", "user", "registered", "default", "outer"]) {
    registry.register(command, () => ran.push(command));
  }
  keybindings.setDefaults([
    { command: "default", other: ["Ctrl+KeyJ"], mac: [], context: "app" },
    { command: "outer", other: ["Ctrl+KeyJ"], mac: [] },
  ]);
  keybindings.setUser([
    { command: "user", other: ["Ctrl+KeyJ"], mac: [], context: "app" },
  ]);
  keybindings.register({
    command: "registered",
    other: ["Ctrl+KeyJ"],
    mac: [],
    context: "app",
  });
  const inner = keybindings.register({
    command: "inner",
    other: ["Ctrl+KeyJ"],
    mac: [],
    context: "inner",
  });
  const handle = (target: unknown) =>
    keybindings.handle(press("KeyJ", { ctrl: true }, { target }).event);

  assert.deepStrictEqual(handle(["inner", "app", "global"]), true);
  assert.deepStrictEqual(handle(["app", "global"]), true);
  assert.deepStrictEqual(ran, ["inner", "user"]);

  inner.dispose();
  handle(["app", "global"]);
  assert.deepStrictEqual(ran.at(-1), "user");
  // 사용자 binding을 풀면(context 없는 outer, app의 기여/표는 남는다) app의 기여 binding이 다음이다.
  keybindings.setUser([]);
  handle(["app", "global"]);
  assert.deepStrictEqual(ran.at(-1), "registered");
});

test("context가 owns한 chord는 바깥 binding에 가지 않고, 그 context의 binding은 받는다", () => {
  const { registry, keybindings } = setup();
  let closed = 0;
  let terminal = 0;
  registry.register("tab.close", () => closed++);
  registry.register("terminal.close", () => terminal++);
  keybindings.setDefaults([
    { command: "tab.close", other: ["Ctrl+KeyW"], mac: [] },
    {
      command: "terminal.close",
      other: ["Ctrl+KeyW"],
      mac: [],
      context: "terminal",
    },
  ]);
  keybindings.defineContext("terminal", {
    owns: (chord) => shellOwns(chord, "other"),
  });
  const terminalKey = press(
    "KeyW",
    { ctrl: true },
    {
      target: ["terminal", "global"],
    },
  );
  const shellKey = press("KeyW", { ctrl: true }, { target: ["global"] });
  assert.deepStrictEqual(keybindings.handle(terminalKey.event), true);
  assert.deepStrictEqual(terminal, 1);
  assert.deepStrictEqual(closed, 0);
  assert.deepStrictEqual(keybindings.handle(shellKey.event), true);
  assert.deepStrictEqual(closed, 1);
});

test("머리 두 타를 지금 부를 수 없으면 기다리지 않고 홑 binding을 바로 실행한다", () => {
  const { registry, keybindings, fireTimer, timers } = setup();
  const ran: string[] = [];
  registry.register("agent.interrupt", () => ran.push("interrupt"));
  registry.register("agent.rewind", () => ran.push("rewind"), {
    when: () => false,
  });
  keybindings.setDefaults([
    { command: "agent.interrupt", other: ["Escape"], mac: [] },
    { command: "agent.rewind", other: ["Escape Escape"], mac: [] },
  ]);
  const first = press("Escape");
  assert.deepStrictEqual(keybindings.handle(first.event), true);
  assert.deepStrictEqual(ran, ["interrupt"]);
  assert.deepStrictEqual(timers.length, 0);
  fireTimer();
  assert.deepStrictEqual(ran, ["interrupt"]);
});

test("두 타의 머리를 누르면 기다렸다가 둘째 타에서 실행하고, 없으면 timeout에 홑 binding을 실행한다", () => {
  const { registry, keybindings, fireTimer } = setup();
  const ran: string[] = [];
  registry.register("agent.interrupt", () => ran.push("interrupt"));
  registry.register("agent.rewind", () => ran.push("rewind"));
  keybindings.setDefaults([
    { command: "agent.interrupt", other: ["Escape"], mac: [] },
    { command: "agent.rewind", other: ["Escape Escape"], mac: [] },
  ]);
  const head = press("Escape");
  assert.deepStrictEqual(keybindings.handle(head.event), true);
  assert.deepStrictEqual(head.seen.prevented, true);
  assert.deepStrictEqual(ran, []);
  // modifier만 누른 keydown(Ctrl을 뗐다 다시 누른 것)은 연속을 끊지도, 키를 삼키지도 않는다.
  const modifier = press("ControlLeft", { ctrl: true }, { key: "Control" });
  assert.deepStrictEqual(keybindings.handle(modifier.event), false);
  assert.deepStrictEqual(modifier.seen.prevented, false);
  fireTimer();
  assert.deepStrictEqual(ran, ["interrupt"]);

  const second = press("Escape");
  keybindings.handle(second.event);
  // 머리 뒤에 modifier만 눌러도 기다림은 이어지고, 둘째 타가 오면 두 타가 된다.
  const again = press("ShiftRight", { shift: true }, { key: "Shift" });
  assert.deepStrictEqual(keybindings.handle(again.event), false);
  assert.deepStrictEqual(again.seen.prevented, false);
  const complete = press("Escape");
  assert.deepStrictEqual(keybindings.handle(complete.event), true);
  assert.deepStrictEqual(ran, ["interrupt", "rewind"]);
});

test("기다리는 중에 다른 key가 오면 머리를 버리고 그 key를 새로 맞춘다", () => {
  const { registry, keybindings, fireTimer } = setup();
  const ran: string[] = [];
  registry.register("agent.interrupt", () => ran.push("interrupt"));
  registry.register("agent.rewind", () => ran.push("rewind"));
  registry.register("files.quick-open", () => ran.push("palette"));
  keybindings.setDefaults([
    { command: "agent.interrupt", other: ["Escape"], mac: [] },
    { command: "agent.rewind", other: ["Escape Escape"], mac: [] },
    { command: "files.quick-open", other: ["Ctrl+KeyP"], mac: [] },
  ]);
  keybindings.handle(press("Escape").event);
  const other = press("KeyP", { ctrl: true });
  assert.deepStrictEqual(keybindings.handle(other.event), true);
  assert.deepStrictEqual(ran, ["palette"]);
  fireTimer();
  assert.deepStrictEqual(ran, ["palette"]);

  // 맞는 binding이 없는 key도 잃지 않고 그대로 지나간다(머리의 홑 binding은 실행되지 않는다).
  keybindings.handle(press("Escape").event);
  const nothing = press("KeyY", { ctrl: true });
  assert.deepStrictEqual(keybindings.handle(nothing.event), false);
  assert.deepStrictEqual(nothing.seen.prevented, false);
  fireTimer();
  assert.deepStrictEqual(ran, ["palette"]);
});

test("연속의 둘째 타가 반복이면 두 타가 되지 않고, 홑 binding도 부르지 않는다", () => {
  const { registry, keybindings, fireTimer } = setup();
  const ran: string[] = [];
  registry.register("agent.interrupt", () => ran.push("interrupt"));
  registry.register("agent.rewind", () => ran.push("rewind"));
  keybindings.setDefaults([
    { command: "agent.interrupt", other: ["Escape"], mac: [] },
    { command: "agent.rewind", other: ["Escape Escape"], mac: [] },
  ]);
  keybindings.handle(press("Escape").event);
  const repeat = press("Escape", {}, { repeat: true });
  assert.deepStrictEqual(keybindings.handle(repeat.event), true);
  assert.deepStrictEqual(ran, []);
  fireTimer();
  assert.deepStrictEqual(ran, ["interrupt"]);
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

test("조합 중과 키를 받지 않는 칸은 넘기고, 눌러 둔 반복은 삼키기만 한다", () => {
  const { registry, keybindings } = setup();
  let closed = 0;
  registry.register("tab.close", () => closed++);
  keybindings.register({ command: "tab.close", other: ["Ctrl+KeyW"], mac: [] });
  const composing = press("KeyW", { ctrl: true }, { isComposing: true });
  const capture = press("KeyW", { ctrl: true }, { target: "capture" });
  const repeat = press("KeyW", { ctrl: true }, { repeat: true });
  assert.deepStrictEqual(keybindings.handle(composing.event), false);
  assert.deepStrictEqual(keybindings.handle(capture.event), false);
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

test("사람이 바꾼 key는 기여·표의 기본 key를 모든 context에서 대신한다", () => {
  const { registry, keybindings } = setup();
  const ran: string[] = [];
  registry.register("agent.cycle-mode", () => ran.push("cycle"));
  keybindings.setDefaults([
    {
      command: "agent.cycle-mode",
      other: ["Shift+Tab"],
      mac: [],
      context: "agentView",
    },
  ]);
  keybindings.register({
    command: "agent.cycle-mode",
    other: ["Shift+Tab"],
    mac: [],
    context: "agentView:claude",
  });
  keybindings.register({
    command: "agent.cycle-mode",
    other: ["Shift+Tab"],
    mac: [],
  });
  keybindings.setUser([
    {
      command: "agent.cycle-mode",
      other: ["Ctrl+KeyK"],
      mac: [],
      context: "agentView",
    },
  ]);
  const stacks = [
    ["agentView:claude", "agentView", "global"],
    ["agentView", "global"],
    ["global"],
  ];
  for (const stack of stacks) {
    const old = press("Tab", { shift: true }, { target: stack });
    assert.deepStrictEqual(keybindings.handle(old.event), false);
    assert.deepStrictEqual(old.seen.prevented, false);
  }
  assert.deepStrictEqual(ran, []);
  const replaced = press("KeyK", { ctrl: true }, { target: stacks[0] });
  assert.deepStrictEqual(keybindings.handle(replaced.event), true);
  assert.deepStrictEqual(ran, ["cycle"]);
});
