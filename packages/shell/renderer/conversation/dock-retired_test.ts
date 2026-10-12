// 옛 대화 dock이 없어졌음을 지킨다. 대화는 project의 Agent 탭과 앱 공간의 Agent 칸이 맡는다(shell/desktop#R37).
import { assertEquals } from "@std/assert";

const RENDERER = new URL("../", import.meta.url);
const MAIN = new URL("../../main/", import.meta.url);

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function read(base: URL, path: string): Promise<string> {
  return Deno.readTextFile(new URL(path, base));
}

Deno.test("shell/desktop#R37 [agent-R4]: dock 화면과 옛 대화 통로 파일이 없다", async () => {
  const gone = [
    "conversation/dock.tsx",
    "conversation/dock.module.css",
    "conversation/dock-slot.tsx",
    "conversation/dock_test.tsx",
    "conversation/source.ts",
    "conversation/core-source.ts",
    "conversation/core-round-trip_test.tsx",
    "conversation/testdata/fake-source.ts",
    "desktop/dev-mock/conversation.ts",
    "workspace/contexts/context-engineer-conversation.ts",
  ];
  for (const path of gone) {
    assertEquals(await exists(new URL(path, RENDERER)), false, path);
  }
});

Deno.test("shell/desktop#R37 [agent-R4]: 세 공간에 dock 토글과 dock 자리가 없다", async () => {
  const spaces = [
    "desktop/lophn-space/lophn-space.tsx",
    "workspace/workspace.tsx",
    "app-frame/app-space.tsx",
  ];
  for (const path of spaces) {
    const text = await read(RENDERER, path);
    for (
      const word of ["DockToggle", "DockSlot", "dockPlacement", "dockOpen"]
    ) {
      assertEquals(text.includes(word), false, `${path} ${word}`);
    }
    assertEquals(text.includes("dock-slot"), false, `${path} dock-slot`);
  }
});

Deno.test("shell/desktop#R37 [agent-R4]: Settings에 [Ask lophn] 단추가 없다", async () => {
  const text = await read(
    RENDERER,
    "desktop/lophn-space/settings/settings-screen.tsx",
  );
  assertEquals(text.includes("ask-lophn"), false);
  assertEquals(text.includes("onAsk"), false);
});

Deno.test("shell/desktop#R37 [agent-R4]: #conversation 시작 자리와 LOPHN_SHELL_START=conversation이 없다", async () => {
  const entry = await read(RENDERER, "desktop/entry.tsx");
  assertEquals(entry.includes("#conversation"), false);
  assertEquals(entry.includes("startOpen"), false);
  const main = await read(MAIN, "desktop/main.ts");
  assertEquals(main.includes('"conversation"'), false);
  assertEquals(main.includes("#conversation"), false);
});
