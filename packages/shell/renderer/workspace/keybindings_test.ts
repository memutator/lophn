import { assertEquals } from "@std/assert";

import {
  KEYBINDINGS,
  type KeyInput,
  type KeyPlatform,
  matchKey,
} from "../../ipc/keybindings.ts";

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

Deno.test("표의 키는 겹치지 않고 팔레트·런처 키를 빼앗지 않으며 shell이 쓰는 Ctrl+글자는 W·B·P뿐이다", () => {
  for (const platform of ["mac", "other"] as KeyPlatform[]) {
    const seen = new Map<string, string>();
    const shell: string[] = [];
    for (const binding of KEYBINDINGS) {
      for (const chord of binding[platform]) {
        const owner = `${binding.command}:${binding.arg ?? ""}`;
        assertEquals(seen.get(chord), undefined, `${platform} ${chord}`);
        seen.set(chord, owner);
        const hit = matchKey(inputOf(chord), platform);
        assertEquals(hit?.command, binding.command, `${platform} ${chord}`);
        assertEquals(hit?.arg, binding.arg, `${platform} ${chord}`);
        if (hit?.shell) shell.push(chord);
      }
    }
    // Ctrl/Cmd+K 팔레트와 Ctrl/Cmd+Shift+L 런처는 main의 창 shortcut이 먼저 받는다.
    const primary = platform === "mac" ? "Cmd" : "Ctrl";
    assertEquals(matchKey(inputOf(`${primary}+KeyK`), platform), null);
    assertEquals(matchKey(inputOf(`${primary}+Shift+KeyL`), platform), null);
    assertEquals(
      shell.sort(),
      platform === "mac" ? [] : [
        "Ctrl+KeyB",
        "Ctrl+KeyP",
        "Ctrl+KeyW",
      ],
    );
  }
});

Deno.test("한글 입력 상태의 키와 modifier가 더 붙은 키를 가려서 판정한다", () => {
  // 한글 입력기에서는 key가 ㅈ이지만 code는 KeyW다.
  assertEquals(
    matchKey(inputOf("Ctrl+KeyW", "ㅈ"), "other")?.command,
    "tab.close",
  );
  // 배열이 달라 code가 다른 자리여도 글자가 W면 닫기다.
  assertEquals(
    matchKey({ ...inputOf("Ctrl+Comma", "w") }, "other")?.command,
    "tab.close",
  );
  // Ctrl+Alt+1(편집기 제목 단계)은 Alt+1(첫 탭)이 아니다.
  assertEquals(matchKey(inputOf("Ctrl+Alt+Digit1"), "other"), null);
  assertEquals(matchKey(inputOf("Alt+Digit1"), "other")?.arg, 1);
  // macOS는 Option+숫자가 글자 입력이라 Ctrl+숫자가 탭, Cmd+숫자가 칸이다.
  assertEquals(matchKey(inputOf("Alt+Digit1"), "mac"), null);
  assertEquals(matchKey(inputOf("Ctrl+Digit3"), "mac")?.command, "tab.nth");
  assertEquals(matchKey(inputOf("Cmd+Digit2"), "mac")?.command, "pane.focus");
  // main이 먼저 받는 것은 macOS의 Cmd+W뿐이다.
  assertEquals(
    matchKey(inputOf("Cmd+KeyW"), "mac", "main")?.command,
    "tab.close",
  );
  assertEquals(matchKey(inputOf("Ctrl+KeyW"), "other", "main"), null);
  assertEquals(matchKey(inputOf("Cmd+Shift+KeyT"), "mac", "main"), null);
});
