// `press`의 key 이름("Enter", "Control+a")과 칠 글을 page의 webContents에 넣는 Electron keyboard event로 바꾼다.
// CDP `Input.dispatchKeyEvent`는 쓰지 않는다: 창 안에서 keyboard focus가 있는 곳(shell 입력칸, 사람이 보던 다른 page)으로
// 가서, agent가 누른 Control+w가 사람의 탭을 닫았다. webContents.sendInputEvent는 focus와 상관없이 그 page에만 간다(실제
// Electron에서 확인: 숨은 탭, 1px로 접힌 guest, shell 입력칸에 focus가 있을 때 모두 page만 받았다).

export type KeyModifier = "shift" | "control" | "alt" | "meta";

/** Electron `KeyboardInputEvent`. keyCode는 Electron accelerator 이름이나 글자 하나다. */
export interface KeyEvent {
  type: "keyDown" | "char" | "keyUp";
  keyCode: string;
  modifiers: KeyModifier[];
}

const MODIFIERS: Record<string, KeyModifier> = {
  alt: "alt",
  control: "control",
  ctrl: "control",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  shift: "shift",
};

// press가 받는 이름 → accelerator 이름과 그 key가 치는 글자.
const NAMED: Record<string, { keyCode: string; text?: string }> = {
  Enter: { keyCode: "Enter", text: "\r" },
  Tab: { keyCode: "Tab" },
  Escape: { keyCode: "Escape" },
  Backspace: { keyCode: "Backspace" },
  Delete: { keyCode: "Delete" },
  ArrowUp: { keyCode: "Up" },
  ArrowDown: { keyCode: "Down" },
  ArrowLeft: { keyCode: "Left" },
  ArrowRight: { keyCode: "Right" },
  Home: { keyCode: "Home" },
  End: { keyCode: "End" },
  PageUp: { keyCode: "PageUp" },
  PageDown: { keyCode: "PageDown" },
  Space: { keyCode: "Space", text: " " },
};

function stroke(
  keyCode: string,
  modifiers: KeyModifier[],
  text: string | undefined,
): KeyEvent[] {
  return [
    { type: "keyDown", keyCode, modifiers },
    ...(text === undefined
      ? []
      : [{ type: "char" as const, keyCode: text, modifiers }]),
    { type: "keyUp", keyCode, modifiers },
  ];
}

/** `press`의 key 하나를 누르고 떼는 event. 모르는 이름이면 undefined다. */
export function pressEvents(spec: string): KeyEvent[] | undefined {
  const parts = spec.split("+");
  const name = parts.pop() ?? "";
  const modifiers: KeyModifier[] = [];
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier === undefined) return undefined;
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }
  // 글자가 입력되는 조합만 글자를 싣는다. Control+a 같은 조합은 단축키다.
  const types = !modifiers.some((m) => m !== "shift");
  const named = NAMED[name];
  if (named !== undefined) {
    return stroke(named.keyCode, modifiers, types ? named.text : undefined);
  }
  if ([...name].length !== 1) return undefined;
  const shifted =
    /^[a-z]$/i.test(name) && modifiers.includes("shift")
      ? name.toUpperCase()
      : name;
  return stroke(shifted, modifiers, types ? shifted : undefined);
}

/** 글을 글자마다 친다. 대문자는 Shift를 같이 누른다. 줄바꿈은 Enter다. */
export function typeEvents(text: string): KeyEvent[][] {
  return [...text].map((char) => {
    if (char === "\n" || char === "\r") return stroke("Enter", [], "\r");
    if (char === "\t") return stroke("Tab", [], undefined);
    return stroke(char, /^[A-Z]$/.test(char) ? ["shift"] : [], char);
  });
}
