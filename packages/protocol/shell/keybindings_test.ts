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
  shellOwns,
} from "./keybindings.ts";

function inputOf(chord: string, key = ""): KeyInput {
  const parts = chord.split(" ")[0]!.split("+");
  return {
    key,
    code: parts.at(-1),
    ctrl: parts.includes("Ctrl"),
    meta: parts.includes("Cmd"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
  };
}

test("기본 표는 platform과 context마다 겹침이 없고, 표의 홑 타는 그 줄로 맞으며, 터미널이 가져가는 Ctrl+글자는 shellOwns가 정한다", () => {
  for (const platform of ["mac", "other"] as KeyPlatform[]) {
    assert.deepStrictEqual(findConflicts(platform, {}), [], platform);
    for (const binding of KEYBINDINGS) {
      for (const chord of binding[platform]) {
        // 두 타는 service가 세고 matchKey는 홑 타만 본다(기본 표에는 아직 없다).
        if (chord.includes(" ")) continue;
        const hit = matchKey(
          inputOf(chord),
          platform,
          undefined,
          undefined,
          binding.context,
        );
        assert.deepStrictEqual(
          hit?.command,
          binding.command,
          `${platform} ${chord}`,
        );
        assert.deepStrictEqual(hit?.arg, binding.arg, `${platform} ${chord}`);
      }
    }
  }
  // Linux·Windows 터미널에서 PTY로 가는 Ctrl+글자 하나는 W·B·P·T·N·O뿐이다.
  const owned = ["KeyW", "KeyB", "KeyP", "KeyT", "KeyN", "KeyO"].map((code) =>
    shellOwns(chordOf(`Ctrl+${code}`), "other"),
  );
  assert.deepStrictEqual(owned, [true, true, true, true, true, true]);
  assert.deepStrictEqual(shellOwns(chordOf("Ctrl+KeyQ"), "other"), true);
  assert.deepStrictEqual(shellOwns(chordOf("Ctrl+Shift+KeyC"), "other"), false);
  assert.deepStrictEqual(shellOwns(chordOf("Ctrl+KeyC"), "mac"), false);
});

function strokeOf(text: string) {
  const parts = text.split("+");
  const code = parts.at(-1)!;
  return {
    text,
    code,
    letter: /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : null,
    ctrl: parts.includes("Ctrl"),
    meta: parts.includes("Cmd"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
  };
}

function chordOf(text: string) {
  return { text, strokes: [strokeOf(text)] };
}

test("한글 입력 상태의 키와 modifier가 더 붙은 키를 가려서 판정하고, context가 있는 줄은 그 context에서만 본다", () => {
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
  assert.deepStrictEqual(matchKey(inputOf("Ctrl+KeyP"), "other", "main"), null);
  assert.deepStrictEqual(
    matchKey(inputOf("Alt+Digit1"), "other", "main"),
    null,
  );
  // context가 있는 줄은 그 context를 아는 곳만 본다.
  assert.deepStrictEqual(
    matchKey(inputOf("Ctrl+Shift+KeyC"), "other")?.command,
    undefined,
  );
  assert.deepStrictEqual(
    matchKey(
      inputOf("Ctrl+Shift+KeyC"),
      "other",
      undefined,
      undefined,
      "terminal",
    )?.command,
    "terminal.copy",
  );
  assert.deepStrictEqual(
    matchKey(inputOf("Escape"), "other", undefined, undefined, "agentView")
      ?.command,
    "agent.interrupt",
  );
  assert.deepStrictEqual(
    matchKey(inputOf("Enter"), "other", undefined, undefined, "composer")
      ?.command,
    "agent.send",
  );
  assert.deepStrictEqual(
    matchKey(inputOf("Ctrl+KeyD"), "other", "main", undefined, "browser")
      ?.command,
    "browser.bookmark",
  );
  // main은 context를 모르면 그 줄을 보지 않고, 두 타는 첫 타만으로 맞지 않는다.
  assert.deepStrictEqual(matchKey(inputOf("Ctrl+KeyD"), "other", "main"), null);
  const twoStroke = compileBindings(
    resolveBindings("other", { "tab.close": ["Ctrl+KeyX Ctrl+KeyE"] }),
  );
  assert.deepStrictEqual(
    matchKey(inputOf("Ctrl+KeyX"), "other", "main", twoStroke),
    null,
  );
});

test("사람이 바꾼 키는 표의 줄을 덮고 main도 따르며, 읽을 수 없는 값은 그 줄만 버린다", () => {
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

  // 겹침은 modifier 순서와 상관없이 잡고, 팔레트 키는 표의 줄이라 "바꾸기"이고 전역 팔레트 키는 예약이다.
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
  const palette = checkChord("Ctrl+KeyK", ["pane.split"], "other", {});
  assert.deepStrictEqual(
    palette.ok ? null : "by" in palette ? palette.by.command : palette.reason,
    "palette.open",
  );
  for (const [chord, reason] of [
    ["Ctrl+Shift+KeyK", "reserved"],
    ["KeyJ", "needs_modifier"],
    ["Shift+KeyJ", "needs_modifier"],
    ["Escape Escape", "needs_modifier"],
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
  // context가 다르면 같은 key를 써도 된다.
  assert.deepStrictEqual(
    checkChord("Ctrl+KeyF", ["tab.rename"], "other", {}).ok,
    true,
  );
  const agent = checkChord(
    "Ctrl+KeyF",
    ["tab.rename"],
    "other",
    {},
    "agentView",
  );
  assert.deepStrictEqual(
    agent.ok ? null : "by" in agent ? agent.by.command : agent.reason,
    "agent.find",
  );
  assert.deepStrictEqual(
    checkChord("Ctrl+Shift+KeyC", ["tab.rename"], "other", {}).ok,
    true,
  );
  const copy = checkChord(
    "Ctrl+Shift+KeyC",
    ["terminal.paste"],
    "other",
    {},
    "terminal",
  );
  assert.deepStrictEqual(
    copy.ok ? null : "by" in copy ? copy.by.command : copy.reason,
    "terminal.copy",
  );
});

test("parseKeyOverrides는 지금 등록되지 않은 ext·app id와 두 타 chord를 남기고, resolveBindings는 표의 줄만 둔다", () => {
  const overrides = parseKeyOverrides({
    "ext.harness-gui.rewind": ["Escape Escape"],
    "app.app_x.save": ["Ctrl+KeyS"],
    "ext.bad": ["Ctrl+KeyJ"],
    "ext.:name": ["Ctrl+KeyJ"],
    "app.panel:no-surface": ["Ctrl+Alt+KeyK"],
    "app.panel:a b:main": ["Ctrl+Alt+KeyK"],
  });
  assert.deepStrictEqual(overrides, {
    "ext.harness-gui.rewind": ["Escape Escape"],
    "app.app_x.save": ["Ctrl+KeyS"],
  });
  assert.deepStrictEqual(parseBindingId("ext.harness-gui.rewind"), {
    command: "ext.harness-gui.rewind",
  });
  assert.deepStrictEqual(parseBindingId("app.app_x.save"), {
    command: "app.app_x.save",
  });
  // 동적 id는 표 밖 기여 binding이 자기 기본 key에 덮는다. 표를 만드는 resolveBindings는 붙이지 않는다.
  assert.deepStrictEqual(
    resolveBindings("other", overrides).length,
    KEYBINDINGS.length,
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

test("겹침은 context마다 보고, 두 타의 머리가 홑 binding과 같아도 겹침이 아니다", () => {
  const conflicts = findConflicts("other", {
    "tab.rename": ["Shift+Ctrl+KeyT"],
    "tab.reveal": ["Ctrl+Shift+KeyK"],
    "tab.keep-open": ["Ctrl+Alt+KeyJ", "Ctrl+Alt+KeyJ"],
  });
  assert.deepStrictEqual(
    conflicts.map(({ ids, reserved }) => ({ ids, reserved })),
    [
      { ids: ["tab.reopen", "tab.rename"], reserved: false },
      { ids: ["tab.reveal"], reserved: true },
    ],
  );
  // context가 다르면 같은 chord라도 겹침이 아니고, 홑 binding의 머리와 두 타는 다른 chord다.
  assert.deepStrictEqual(
    findConflicts("other", { "tab.rename": ["Ctrl+KeyF"] }),
    [],
  );
  assert.deepStrictEqual(
    findConflicts("other", {
      "agent.interrupt": ["Escape"],
      "agent.rewind": ["Escape Escape"],
    }),
    [],
  );
});
