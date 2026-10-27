// 창 안 shortcut. OS 전역 단축키로 등록하지 않고 창에 속한 webContents의
// before-input-event만 본다. 그래서 다른 앱에 focus가 있으면 Ctrl+K가 lophn에 오지 않는다.
// 앱 view·overlay·터미널에 focus가 있어도 같은 창의 shell renderer가 받는다.
import { matchKey } from "../../ipc/keybindings.ts";
import {
  type PaletteShortcut,
  WINDOW_SHORTCUTS,
  type WindowShortcut,
} from "../../ipc/shortcuts.ts";

/** Electron `Input`에서 쓰는 부분. */
interface KeyInput {
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

const CHORDS = (Object.keys(WINDOW_SHORTCUTS) as PaletteShortcut[]).map(
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
 * Control이고 다른 쪽 modifier가 같이 눌리면 맞지 않는다. 작업대 단축키 표에서는 `main`이 적힌
 * 것(탭 이동·닫기·다시 열기)만 본다.
 */
function windowShortcut(
  input: KeyInput,
  platform: string,
): WindowShortcut | null {
  if (input.type !== "keyDown") return null;
  const mac = platform === "darwin";
  const primary = mac ? input.meta : input.control;
  const other = mac ? input.control : input.meta;
  if (primary && !other) {
    const letter = letterOf(input);
    const found = CHORDS.find(
      ({ chord }) =>
        chord.key === letter &&
        chord.shift === input.shift &&
        chord.alt === input.alt,
    );
    if (found) return found.name;
  }
  const hit = matchKey(
    {
      key: input.key,
      code: input.code,
      ctrl: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
    },
    mac ? "mac" : "other",
    "main",
  );
  return hit === null ? null : (hit.command as WindowShortcut);
}

interface InputSource {
  on(
    event: "before-input-event",
    listener: (event: { preventDefault(): void }, input: KeyInput) => void,
  ): void;
}

/**
 * webContents 하나의 키를 본다. `deliver`가 창의 shell renderer를 찾았다고 답할 때만 키를
 * 페이지에 넘기지 않는다. 보호 창처럼 shell 창이 아닌 곳의 키는 그대로 둔다. 눌러 둔 반복은
 * renderer로 보내지 않지만 키는 삼킨다. 반복에서 삼키지 않으면 menu 단축키(Close Window)가 탄다.
 */
export function listenShortcuts(
  source: InputSource,
  platform: string,
  deliver: (shortcut: WindowShortcut, send: boolean) => boolean,
): void {
  source.on("before-input-event", (event, input) => {
    const shortcut = windowShortcut(input, platform);
    if (shortcut !== null && deliver(shortcut, input.isAutoRepeat !== true)) {
      event.preventDefault();
    }
  });
}
