// `press`의 key 이름("Enter", "Control+a")을 CDP `Input.dispatchKeyEvent` 값으로 바꾼다.
const MODIFIERS: Record<string, number> = {
  alt: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

const NAMED: Record<string, { code: string; keyCode: number; text?: string }> =
  {
    Enter: { code: "Enter", keyCode: 13, text: "\r" },
    Tab: { code: "Tab", keyCode: 9 },
    Escape: { code: "Escape", keyCode: 27 },
    Backspace: { code: "Backspace", keyCode: 8 },
    Delete: { code: "Delete", keyCode: 46 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
    Home: { code: "Home", keyCode: 36 },
    End: { code: "End", keyCode: 35 },
    PageUp: { code: "PageUp", keyCode: 33 },
    PageDown: { code: "PageDown", keyCode: 34 },
    Space: { code: "Space", keyCode: 32, text: " " },
  };

// 글자가 아닌 편집 key는 text가 없어 page가 focus를 가진 것처럼 처리하지 않으면 안 먹는다. 편집 command를 같이 보낸다.
const COMMANDS: Record<string, string> = {
  Backspace: "deleteBackward",
  Delete: "deleteForward",
  ArrowLeft: "moveLeft",
  ArrowRight: "moveRight",
  ArrowUp: "moveUp",
  ArrowDown: "moveDown",
};
const SHORTCUTS: Record<string, string> = {
  a: "selectAll",
  c: "copy",
  x: "cut",
  v: "paste",
  z: "undo",
};

export interface KeyEvent {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  text?: string;
  commands?: string[];
}

export function parseKey(spec: string): KeyEvent | undefined {
  const parts = spec.split("+");
  const name = parts.pop() ?? "";
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIERS[part.toLowerCase()];
    if (bit === undefined) return undefined;
    modifiers |= bit;
  }
  // 글자가 입력되는 조합만 text를 싣는다. Control+a 같은 조합은 단축키다.
  const types = (modifiers & 7) === 0;
  const named = NAMED[name];
  const command = (modifiers & 6) !== 0 ? SHORTCUTS[name] : COMMANDS[name];
  if (named !== undefined) {
    return {
      ...(command === undefined ? {} : { commands: [command] }),
      key: name === "Space" ? " " : name,
      code: named.code,
      windowsVirtualKeyCode: named.keyCode,
      modifiers,
      ...(types && named.text !== undefined ? { text: named.text } : {}),
    };
  }
  if ([...name].length !== 1) return undefined;
  const upper = name.toUpperCase();
  const letter = /^[a-z]$/i.test(name);
  const key = letter && (modifiers & 8) !== 0 ? upper : name;
  return {
    key,
    code: letter ? `Key${upper}` : /^[0-9]$/.test(name) ? `Digit${name}` : "",
    windowsVirtualKeyCode:
      letter || /^[0-9]$/.test(name) ? upper.charCodeAt(0) : name.charCodeAt(0),
    modifiers,
    ...(types ? { text: key } : {}),
    ...(command === undefined ? {} : { commands: [command] }),
  };
}

// driver가 지금 key event를 보내는 page(webContents id → 보내는 중인 수). 그 page의 키는 창 단축키로 넘기지 않는다(desktop.ts):
// CDP `Input.dispatchKeyEvent`도 guest의 before-input-event를 거쳐, agent가 누른 Control+w가 창의 `tab.close`가 되어 사람의 탭을
// 닫았다. driver와 창 단축키는 서로 다른 wiring이고 둘이 같이 보는 것이 webContents id뿐이라 이 module에 둔다. Chromium은 key가
// before-input-event를 지난 뒤에 그 명령에 답하므로 보내는 동안만 표시하면 된다.
const sending = new Map<number, number>();

/** page에 key event를 보내는 동안 그 page를 표시한다. */
export async function sendingKeys<T>(
  page: number,
  run: () => Promise<T>,
): Promise<T> {
  sending.set(page, (sending.get(page) ?? 0) + 1);
  try {
    return await run();
  } finally {
    const left = (sending.get(page) ?? 1) - 1;
    if (left === 0) sending.delete(page);
    else sending.set(page, left);
  }
}

/**
 * 이 webContents의 키를 창 단축키로 넘기는가. driver가 key를 보내는 중이면 아니다: 넘기지도 삼키지도 않아 key는 page에만 간다.
 * 사람이 그 탭에 친 키는 그대로 넘긴다.
 */
export function forwardsShortcut(contents: number): boolean {
  return !sending.has(contents);
}

/** CDP 명령 하나를 보내는 길이다. driver는 기한을 건 send를 준다. */
export type CdpSend = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

/** `press`의 key 하나를 누르고 뗀다. 모르는 이름이면 보내지 않고 false다. */
export async function pressKey(send: CdpSend, spec: string): Promise<boolean> {
  const event = parseKey(spec);
  if (event === undefined) return false;
  await send("Input.dispatchKeyEvent", {
    ...event,
    type: event.text === undefined ? "rawKeyDown" : "keyDown",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: event.key,
    code: event.code,
    windowsVirtualKeyCode: event.windowsVirtualKeyCode,
    modifiers: event.modifiers,
  });
  return true;
}

/** 글자 하나의 keyDown·keyUp이다. text를 달아 보낸다. */
export function typeChar(send: CdpSend, char: string): Promise<unknown>[] {
  const enter = char === "\n" || char === "\r";
  const key = enter ? "Enter" : char;
  const typed = enter ? "\r" : char;
  return [
    send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      text: typed,
      unmodifiedText: typed,
    }),
    send("Input.dispatchKeyEvent", { type: "keyUp", key }),
  ];
}

/** 글을 글자마다 친다. */
export async function typeText(send: CdpSend, text: string): Promise<void> {
  await Promise.all([...text].flatMap((char) => typeChar(send, char)));
}
