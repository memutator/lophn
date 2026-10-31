import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkChord,
  compileBindings,
  KEYBINDINGS,
  type KeyInput,
  type KeyPlatform,
  matchKey,
  parseKeyOverrides,
  resolveBindings,
} from "./keybindings.ts";

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

test("표의 키는 겹치지 않고 팔레트·런처 키를 빼앗지 않으며 shell이 쓰는 Ctrl+글자는 W·B·P뿐이다", () => {
  for (const platform of ["mac", "other"] as KeyPlatform[]) {
    const seen = new Map<string, string>();
    const shell: string[] = [];
    for (const binding of KEYBINDINGS) {
      for (const chord of binding[platform]) {
        const owner = `${binding.command}:${binding.arg ?? ""}`;
        assert.deepStrictEqual(
          seen.get(chord),
          undefined,
          `${platform} ${chord}`,
        );
        seen.set(chord, owner);
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
      platform === "mac" ? [] : ["Ctrl+KeyB", "Ctrl+KeyP", "Ctrl+KeyW"],
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
