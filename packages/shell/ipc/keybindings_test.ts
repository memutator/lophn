import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appPanelBindingId,
  checkChord,
  compileBindings,
  findConflicts,
  KEYBINDINGS,
  type KeyInput,
  type KeyPlatform,
  matchKey,
  parseBindingId,
  parseKeyOverrides,
  resolveBindings,
} from "./keybindings.ts";
import { isWindowShortcut } from "./shortcuts.ts";

function inputOf(chord: string, key = ""): KeyInput {
  const parts = chord.split("+");
  return {
    key,
    code: parts.at(-1),
    ctrl: parts.includes("Ctrl"),
    meta: parts.includes("Cmd"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
  };
}

test("기본 표는 platform마다 겹침이 없고 RESERVED와 겹치지 않으며 shell이 쓰는 Ctrl+글자는 W·B·P·T·N·O뿐이다", () => {
  for (const platform of ["mac", "other"] as KeyPlatform[]) {
    const shell: string[] = [];
    assert.deepStrictEqual(findConflicts(platform, {}), [], platform);
    for (const binding of KEYBINDINGS) {
      for (const chord of binding[platform]) {
        const hit = matchKey(inputOf(chord), platform);
        assert.deepStrictEqual(
          hit?.command,
          binding.command,
          `${platform} ${chord}`,
        );
        assert.deepStrictEqual(hit?.arg, binding.arg, `${platform} ${chord}`);
        if (hit?.shell) shell.push(chord);
      }
    }
    // Ctrl/Cmd+K 팔레트와 Ctrl/Cmd+Shift+L 런처는 main의 창 shortcut이 먼저 받는다.
    const primary = platform === "mac" ? "Cmd" : "Ctrl";
    assert.deepStrictEqual(
      matchKey(inputOf(`${primary}+KeyK`), platform),
      null,
    );
    assert.deepStrictEqual(
      matchKey(inputOf(`${primary}+Shift+KeyL`), platform),
      null,
    );
    assert.deepStrictEqual(
      shell.sort(),
      platform === "mac"
        ? []
        : [
            "Ctrl+KeyB",
            "Ctrl+KeyN",
            "Ctrl+KeyO",
            "Ctrl+KeyP",
            "Ctrl+KeyT",
            "Ctrl+KeyW",
          ],
    );
  }
});

test("한글 입력 상태의 키와 modifier가 더 붙은 키를 가려서 판정한다", () => {
  // 한글 입력기에서는 key가 ㅈ이지만 code는 KeyW다.
  assert.deepStrictEqual(
    matchKey(inputOf("Ctrl+KeyW", "ㅈ"), "other")?.command,
    "tab.close",
  );
  // 배열이 달라 code가 다른 자리여도 글자가 W면 닫기다.
  assert.deepStrictEqual(
    matchKey({ ...inputOf("Ctrl+Comma", "w") }, "other")?.command,
    "tab.close",
  );
  // Ctrl+Alt+1(편집기 제목 단계)은 Alt+1(첫 탭)이 아니다.
  assert.deepStrictEqual(matchKey(inputOf("Ctrl+Alt+Digit1"), "other"), null);
  assert.deepStrictEqual(matchKey(inputOf("Alt+Digit1"), "other")?.arg, 1);
  // macOS는 Option+숫자가 글자 입력이라 Ctrl+숫자가 탭, Cmd+숫자가 split의 쪽이다.
  assert.deepStrictEqual(matchKey(inputOf("Alt+Digit1"), "mac"), null);
  assert.deepStrictEqual(
    matchKey(inputOf("Ctrl+Digit3"), "mac")?.command,
    "tab.nth",
  );
  assert.deepStrictEqual(
    matchKey(inputOf("Cmd+Digit2"), "mac")?.command,
    "pane.focus",
  );
  // main이 먼저 받는 것은 탭 이동·닫기·다시 열기다(page가 키를 못 받아도 shell이 받게).
  assert.deepStrictEqual(
    matchKey(inputOf("Cmd+KeyW"), "mac", "main")?.command,
    "tab.close",
  );
  assert.deepStrictEqual(
    matchKey(inputOf("Ctrl+KeyW"), "other", "main")?.command,
    "tab.close",
  );
  assert.deepStrictEqual(
    matchKey(inputOf("Ctrl+Tab"), "other", "main")?.command,
    "tab.next",
  );
  assert.deepStrictEqual(
    matchKey(inputOf("Ctrl+Shift+KeyT"), "other", "main")?.command,
    "tab.reopen",
  );
  // page가 쓰는 키와 나머지 작업대 키는 main이 가져가지 않는다.
  assert.deepStrictEqual(matchKey(inputOf("Ctrl+KeyP"), "other", "main"), null);
  assert.deepStrictEqual(
    matchKey(inputOf("Alt+Digit1"), "other", "main"),
    null,
  );
});

test("사람이 바꾼 키는 검사를 지난 것만 덮고 main이 받는 키도 바뀐 키를 따른다", () => {
  // 모르는 id, 읽을 수 없는 chord, 너무 많은 chord는 버리고 그 줄은 표의 키다. 빈 배열은 키를 뺀 것이다.
  const overrides = parseKeyOverrides({
    "tab.close": ["Ctrl+Shift+KeyW"],
    "sidebar.toggle": [],
    "no.such": ["Ctrl+KeyJ"],
    "tab.next": ["Ctrl+Bogus"],
    "tab.prev": [
      "Ctrl+KeyA",
      "Ctrl+KeyB",
      "Ctrl+KeyC",
      "Ctrl+KeyD",
      "Ctrl+KeyE",
    ],
  });
  assert.deepStrictEqual(overrides, {
    "tab.close": ["Ctrl+Shift+KeyW"],
    "sidebar.toggle": [],
  });
  assert.deepStrictEqual(parseKeyOverrides("broken"), {});

  const compiled = compileBindings(resolveBindings("other", overrides));
  const hit = (chord: string, only?: "main") =>
    matchKey(inputOf(chord), "other", only, compiled)?.command ?? null;
  assert.deepStrictEqual(hit("Ctrl+Shift+KeyW", "main"), "tab.close");
  assert.deepStrictEqual(hit("Ctrl+KeyW", "main"), null);
  assert.deepStrictEqual(hit("Ctrl+KeyB"), null);
  assert.deepStrictEqual(hit("Ctrl+Tab", "main"), "tab.next");

  // 겹침은 modifier 순서와 상관없이 잡고, 팔레트 키와 modifier 없는 키는 받지 않는다.
  const taken = checkChord(
    "Shift+Ctrl+KeyW",
    ["pane.split"],
    "other",
    overrides,
  );
  assert.deepStrictEqual(
    taken.ok ? null : [taken.reason, "by" in taken ? taken.by.command : null],
    ["taken", "tab.close"],
  );
  assert.deepStrictEqual(
    checkChord("Ctrl+KeyW", ["pane.split"], "other", overrides).ok,
    true,
  );
  for (const [chord, reason] of [
    ["Ctrl+KeyK", "reserved"],
    ["Ctrl+Shift+KeyC", "reserved"],
    ["KeyJ", "needs_modifier"],
    ["Shift+KeyJ", "needs_modifier"],
    ["Ctrl+Bogus", "unsupported"],
  ] as const) {
    const check = checkChord(chord, ["pane.split"], "other", {});
    assert.deepStrictEqual(check.ok ? null : check.reason, reason, chord);
  }
  assert.deepStrictEqual(
    checkChord("F5", ["pane.split"], "other", {}).ok,
    true,
  );
  // 번호 줄은 자기 번호들의 키와 겹쳐도 되지만 다른 줄의 번호 키(Ctrl+1 split 쪽)와는 안 된다.
  const tabs = Array.from({ length: 10 }, (_, n) => `tab.nth:${n}`);
  assert.deepStrictEqual(checkChord("Alt+Digit3", tabs, "other", {}).ok, true);
  const pane = checkChord("Ctrl+Digit1", tabs, "other", {});
  assert.deepStrictEqual(
    pane.ok ? null : "by" in pane ? pane.by.command : pane.reason,
    "pane.focus",
  );
});

test("parseKeyOverrides는 모양이 맞는 app.panel id만 남기고 resolveBindings가 그 binding을 표 뒤에 붙인다", () => {
  const id = appPanelBindingId("app_x", "main");
  const overrides = parseKeyOverrides({
    [id]: ["Ctrl+Alt+KeyJ"],
    "app.panel:no-surface": ["Ctrl+Alt+KeyK"],
    "app.panel:a b:main": ["Ctrl+Alt+KeyK"],
    "app.panel:a:b:c": ["Ctrl+Alt+KeyK"],
  });
  assert.deepStrictEqual(overrides, { [id]: ["Ctrl+Alt+KeyJ"] });
  assert.deepStrictEqual(parseBindingId(id), {
    command: "app.panel",
    arg: "app_x:main",
  });
  const resolved = resolveBindings("other", overrides);
  const last = resolved.at(-1)!;
  assert.deepStrictEqual(
    [
      resolved.length,
      last.command,
      last.arg,
      last.section,
      last.other,
      last.mac,
    ],
    [
      KEYBINDINGS.length + 1,
      "app.panel",
      "app_x:main",
      "app",
      ["Ctrl+Alt+KeyJ"],
      [],
    ],
  );
  // 앱 단축키는 main이 먼저 받아 binding id를 보낸다.
  const compiled = compileBindings(resolved);
  assert.deepStrictEqual(
    matchKey(inputOf("Ctrl+Alt+KeyJ"), "other", "main", compiled)?.id,
    id,
  );
});

test("사람이 단 키가 다른 binding의 기본 키나 RESERVED와 같으면 findConflicts가 그 둘을 낸다", () => {
  const conflicts = findConflicts("other", {
    "tab.rename": ["Shift+Ctrl+KeyT"],
    "tab.reveal": ["Ctrl+KeyC", "Ctrl+KeyC"],
    "tab.keep-open": ["Ctrl+Alt+KeyJ", "Ctrl+Alt+KeyJ"],
  });
  assert.deepStrictEqual(
    conflicts.map(({ ids, reserved }) => ({ ids, reserved })),
    [
      { ids: ["tab.reopen", "tab.rename"], reserved: false },
      { ids: ["tab.reveal"], reserved: true },
    ],
  );
});

test("isWindowShortcut은 palette·home·표의 binding id·app.panel id를 받고 모르는 글자는 거절한다", () => {
  for (const ok of [
    "palette",
    "home",
    "tab.close",
    "desk.nth:3",
    appPanelBindingId("app_x", "main"),
  ]) {
    assert.deepStrictEqual(isWindowShortcut(ok), true, ok);
  }
  for (const bad of [
    "desk.nth:10",
    "tab.bogus",
    "app.panel",
    "app.panel:a",
    3,
    null,
  ]) {
    assert.deepStrictEqual(isWindowShortcut(bad), false, String(bad));
  }
});
