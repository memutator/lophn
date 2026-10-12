// 창 안 shortcut. OS 전역 단축키로 등록하지 않고 창에 속한 webContents의
// before-input-event만 본다. 그래서 다른 앱에 focus가 있으면 Ctrl+K가 lophn에 오지 않는다.
// 앱 view·overlay·터미널에 focus가 있어도 같은 창의 shell renderer가 받는다.
import { WINDOW_SHORTCUTS, type WindowShortcut } from "../../ipc/shortcuts.ts";

/** Electron `Input`에서 쓰는 부분. */
export interface KeyInput {
  readonly type: string;
  readonly key: string;
  readonly code?: string;
  readonly shift: boolean;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly isAutoRepeat?: boolean;
}

interface Chord {
  readonly key: string;
  readonly shift: boolean;
  readonly alt: boolean;
}

// 표의 accelerator는 CommandOrControl과 Shift·Alt, 글자 하나만 쓴다.
function chordOf(accelerator: string): Chord {
  const parts = accelerator.split("+");
  const key = parts.at(-1)!.toLowerCase();
  return { key, shift: parts.includes("Shift"), alt: parts.includes("Alt") };
}

const CHORDS = (Object.keys(WINDOW_SHORTCUTS) as WindowShortcut[]).map(
  (name) => ({ name, chord: chordOf(WINDOW_SHORTCUTS[name]) }),
);

// 배열이 바뀌어도 같은 글쇠를 보도록 물리 자리(KeyK)를 먼저 본다.
function letterOf(input: KeyInput): string {
  const code = input.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  return input.key.toLowerCase();
}

/**
 * 키 입력이 창 shortcut이면 그 이름. CommandOrControl은 macOS에서 Command, 다른 OS에서
 * Control이고 다른 쪽 modifier가 같이 눌리면 맞지 않는다. 눌러 둔 반복은 한 번만 친다.
 */
export function windowShortcut(
  input: KeyInput,
  platform: string,
): WindowShortcut | null {
  if (input.type !== "keyDown" || input.isAutoRepeat) return null;
  const mac = platform === "darwin";
  const primary = mac ? input.meta : input.control;
  const other = mac ? input.control : input.meta;
  if (!primary || other) return null;
  const letter = letterOf(input);
  const found = CHORDS.find(({ chord }) =>
    chord.key === letter && chord.shift === input.shift &&
    chord.alt === input.alt
  );
  return found?.name ?? null;
}

export interface InputSource {
  on(
    event: "before-input-event",
    listener: (event: { preventDefault(): void }, input: KeyInput) => void,
  ): void;
}

/**
 * webContents 하나의 키를 본다. `deliver`가 창의 shell renderer에 보냈다고 답할 때만 키를
 * 페이지에 넘기지 않는다. 보호 창처럼 shell 창이 아닌 곳의 키는 그대로 둔다.
 */
export function listenShortcuts(
  source: InputSource,
  platform: string,
  deliver: (shortcut: WindowShortcut) => boolean,
): void {
  source.on("before-input-event", (event, input) => {
    const shortcut = windowShortcut(input, platform);
    if (shortcut !== null && deliver(shortcut)) event.preventDefault();
  });
}
