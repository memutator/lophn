// 순수 터미널 입력 인코더. CLI, 내장 agent tool, service의 commandInput 모두 이 한 벌을 쓴다.
// 라이브 TerminalModes(DECCKM, bracketed paste, mouse tracking/encoding, Kitty keyboard flags)를 읽어 바이트로 변환한다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  TUI_KEYS_MAX,
  TUI_PASTE_MAX,
  TUI_TYPE_MAX,
  type TerminalModes,
} from "../../protocol/lophn-agent/terminal-use.ts";

export const SUPPORTED_KEY_SUMMARY =
  "Modifiers: Ctrl+/Control+/C-, Alt+/Meta+/Option+/M-, Shift+/S-. " +
  "Keys: Enter/Return, Tab, Escape/Esc, Backspace/BSpace, Space, " +
  "Up/ArrowUp, Down/ArrowDown, Left/ArrowLeft, Right/ArrowRight, " +
  "Home, End, PageUp/PgUp, PageDown/PgDn, Insert/Ins, Delete/Del, F1-F12, or any single printable character.";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/** 리터럴 텍스트 타이핑 인코딩. 자동 \r 부착 없음. 제어문자·개행 거부. */
export function encodeType(text: string): Result<string> {
  const length = [...text].length;
  if (length < 1 || length > TUI_TYPE_MAX) {
    return invalid(`text length must be between 1 and ${TUI_TYPE_MAX}`);
  }
  if (text.includes("\n") || text.includes("\r")) {
    return invalid(
      "type does not accept newlines; use `paste` for multiline text or `press Enter` for a newline",
    );
  }
  if (hasControlChar(text)) {
    return invalid(
      "type does not accept control characters; use `press` for control keys",
    );
  }
  return ok(text);
}

/** 붙여넣기 인코딩. 내부 ESC[201~ 와 NUL을 지우고, bracketed_paste 모드일 때만 ESC[200~ … ESC[201~로 감싼다. */
export function encodePaste(
  text: string,
  modes: Pick<TerminalModes, "bracketed_paste">,
): Result<string> {
  const length = [...text].length;
  if (length < 1 || length > TUI_PASTE_MAX) {
    return invalid(`paste length must be between 1 and ${TUI_PASTE_MAX}`);
  }
  // NUL을 먼저 지워 `\x1b[20\x001~`가 우회 조립되지 않게 한다.
  let safe = text.replaceAll("\x00", "");
  while (safe.includes("\x1b[201~")) {
    safe = safe.replaceAll("\x1b[201~", "");
  }
  if (modes.bracketed_paste) {
    return ok(`\x1b[200~${safe}\x1b[201~`);
  }
  return ok(safe.replace(/\r\n?/g, "\n").replace(/\n/g, "\r"));
}

type Modifiers = {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
};

type ParsedKey = {
  modifiers: Modifiers;
  key: string;
};

const PREFIX_PATTERNS: readonly [RegExp, keyof Modifiers][] = [
  [/^control\+/i, "ctrl"],
  [/^ctrl\+/i, "ctrl"],
  [/^c-/i, "ctrl"],
  [/^option\+/i, "alt"],
  [/^meta\+/i, "alt"],
  [/^alt\+/i, "alt"],
  [/^m-/i, "alt"],
  [/^shift\+/i, "shift"],
  [/^s-/i, "shift"],
];

function parseKeyToken(token: string): ParsedKey | null {
  if (token.length === 0) return null;
  const modifiers: Modifiers = { shift: false, alt: false, ctrl: false };
  let rest = token;
  while (rest.length > 0) {
    let matched = false;
    for (const [pattern, mod] of PREFIX_PATTERNS) {
      const m = pattern.exec(rest);
      if (m !== null && m[0].length < rest.length) {
        modifiers[mod] = true;
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  if (rest.length === 0) return null;
  return { modifiers, key: rest };
}

function modifierParam(m: Modifiers): number {
  return 1 + (m.shift ? 1 : 0) + (m.alt ? 2 : 0) + (m.ctrl ? 4 : 0);
}

const CURSOR_FINALS: Readonly<Record<string, string>> = {
  up: "A",
  arrowup: "A",
  down: "B",
  arrowdown: "B",
  right: "C",
  arrowright: "C",
  left: "D",
  arrowleft: "D",
  home: "H",
  end: "F",
};

const TILDE_CODES: Readonly<Record<string, number>> = {
  insert: 2,
  ins: 2,
  delete: 3,
  del: 3,
  pageup: 5,
  pgup: 5,
  pagedown: 6,
  pgdn: 6,
  f5: 15,
  f6: 17,
  f7: 18,
  f8: 19,
  f9: 20,
  f10: 21,
  f11: 23,
  f12: 24,
};

const F1_F4_FINALS: Readonly<Record<string, string>> = {
  f1: "P",
  f2: "Q",
  f3: "R",
  f4: "S",
};

const SPECIAL_CODEPOINTS: Readonly<
  Record<string, { codepoint: number; base: string }>
> = {
  enter: { codepoint: 13, base: "\r" },
  return: { codepoint: 13, base: "\r" },
  tab: { codepoint: 9, base: "\t" },
  escape: { codepoint: 27, base: "\x1b" },
  esc: { codepoint: 27, base: "\x1b" },
  backspace: { codepoint: 127, base: "\x7f" },
  bspace: { codepoint: 127, base: "\x7f" },
  space: { codepoint: 32, base: " " },
};

function encodeCtrlChar(ch: string): string | null {
  const lower = ch.toLowerCase();
  const code = lower.charCodeAt(0);
  if (code >= 0x61 && code <= 0x7a) {
    return String.fromCharCode(code - 0x60);
  }
  switch (ch) {
    case "@":
    case "2":
    case " ":
      return "\x00";
    case "[":
    case "3":
      return "\x1b";
    case "\\":
    case "4":
      return "\x1c";
    case "]":
    case "5":
      return "\x1d";
    case "^":
    case "6":
      return "\x1e";
    case "_":
    case "-":
    case "7":
    case "/":
      return "\x1f";
    case "?":
    case "8":
      return "\x7f";
    default:
      return null;
  }
}

function encodeSingleKey(token: string, modes: TerminalModes): string | null {
  const parsed = parseKeyToken(token);
  if (parsed === null) return null;
  const { modifiers, key } = parsed;
  const mod = modifierParam(modifiers);
  const hasMod = mod > 1;
  const lower = key.toLowerCase();
  const kittyDisambiguate = (modes.kitty_keyboard_flags & 1) !== 0;

  // 방향·Home·End (DECCKM 적용).
  const cursorFinal = CURSOR_FINALS[lower];
  if (cursorFinal !== undefined) {
    if (hasMod) return `\x1b[1;${mod}${cursorFinal}`;
    return modes.application_cursor_keys
      ? `\x1bO${cursorFinal}`
      : `\x1b[${cursorFinal}`;
  }

  // F1-F4 (SS3 / CSI 1;<mod>).
  const f14 = F1_F4_FINALS[lower];
  if (f14 !== undefined) {
    return hasMod ? `\x1b[1;${mod}${f14}` : `\x1bO${f14}`;
  }

  // Insert/Delete/PageUp/PageDown/F5-F12.
  const tilde = TILDE_CODES[lower];
  if (tilde !== undefined) {
    return hasMod ? `\x1b[${tilde};${mod}~` : `\x1b[${tilde}~`;
  }

  // Enter/Tab/Escape/Backspace/Space.
  const special = SPECIAL_CODEPOINTS[lower];
  if (special !== undefined) {
    if (hasMod && kittyDisambiguate && lower !== "space") {
      return `\x1b[${special.codepoint};${mod}u`;
    }
    if (
      lower === "tab" &&
      modifiers.shift &&
      !modifiers.ctrl &&
      !modifiers.alt
    ) {
      return "\x1b[Z";
    }
    if (lower === "space" && modifiers.ctrl) {
      return modifiers.alt ? "\x1b\x00" : "\x00";
    }
    if ((lower === "backspace" || lower === "bspace") && modifiers.ctrl) {
      return modifiers.alt ? "\x1b\x08" : "\x08";
    }
    if (modifiers.alt) {
      return `\x1b${special.base}`;
    }
    return special.base;
  }

  // 단일 출력 가능 문자.
  const chars = [...key];
  if (chars.length !== 1) return null;
  const ch = chars[0]!;
  const cp = ch.codePointAt(0)!;
  if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) return null;

  if (kittyDisambiguate && (modifiers.ctrl || modifiers.alt)) {
    const baseCp =
      cp >= 0x41 && cp <= 0x5a ? ch.toLowerCase().codePointAt(0)! : cp;
    return `\x1b[${baseCp};${mod}u`;
  }

  if (modifiers.ctrl) {
    const ctrlByte = encodeCtrlChar(ch);
    if (ctrlByte === null) return null;
    return modifiers.alt ? `\x1b${ctrlByte}` : ctrlByte;
  }

  let out = ch;
  if (modifiers.shift && cp >= 0x61 && cp <= 0x7a) {
    out = ch.toUpperCase();
  }
  if (modifiers.alt) {
    return `\x1b${out}`;
  }
  return out;
}

/** 이름 키 목록 인코딩. 하나라도 알 수 없는 토큰이면 전송 전 전체를 거부하고 지원 키 목록을 안내한다. */
export function encodePress(
  keys: readonly string[],
  modes: TerminalModes,
): Result<string[]> {
  if (keys.length < 1 || keys.length > TUI_KEYS_MAX) {
    return invalid(`keys count must be between 1 and ${TUI_KEYS_MAX}`);
  }
  const encoded: string[] = [];
  for (const token of keys) {
    const seq = encodeSingleKey(token, modes);
    if (seq === null) {
      return invalid(`unknown key "${token}". ${SUPPORTED_KEY_SUMMARY}`);
    }
    encoded.push(seq);
  }
  return ok(encoded);
}

export type MouseInput = {
  action: "click" | "down" | "up" | "move" | "scroll_up" | "scroll_down";
  col: number;
  row: number;
  button?: "left" | "middle" | "right";
  modifiers?: readonly ("shift" | "alt" | "ctrl")[];
  force?: boolean;
};

/** 마우스 이벤트 SGR 1006 인코딩. 좌표 범위와 프로그램의 mouse_tracking 활성 여부를 검사한다. */
export function encodeMouse(
  input: MouseInput,
  size: { columns: number; rows: number },
  modes: Pick<TerminalModes, "mouse_tracking" | "mouse_encoding">,
): Result<string> {
  if (
    !Number.isInteger(input.col) ||
    !Number.isInteger(input.row) ||
    input.col < 0 ||
    input.col >= size.columns ||
    input.row < 0 ||
    input.row >= size.rows
  ) {
    return invalid(
      `mouse coordinates (${input.col}, ${input.row}) out of bounds for ${size.columns}x${size.rows}`,
    );
  }
  if (modes.mouse_tracking === "none" && input.force !== true) {
    return err({
      code: "conflict",
      message:
        "program has not enabled mouse tracking; pass --force to send mouse events anyway or use keyboard keys",
    });
  }

  const buttonCode =
    input.button === "middle" ? 1 : input.button === "right" ? 2 : 0;
  let modBits = 0;
  if (input.modifiers) {
    if (input.modifiers.includes("shift")) modBits |= 4;
    if (input.modifiers.includes("alt")) modBits |= 8;
    if (input.modifiers.includes("ctrl")) modBits |= 16;
  }

  const x = input.col + 1;
  const y = input.row + 1;

  switch (input.action) {
    case "click": {
      const cb = buttonCode | modBits;
      return ok(`\x1b[<${cb};${x};${y}M\x1b[<${cb};${x};${y}m`);
    }
    case "down": {
      const cb = buttonCode | modBits;
      return ok(`\x1b[<${cb};${x};${y}M`);
    }
    case "up": {
      const cb = buttonCode | modBits;
      return ok(`\x1b[<${cb};${x};${y}m`);
    }
    case "move": {
      const base = input.button === undefined ? 35 : 32 + buttonCode;
      const cb = base | modBits;
      return ok(`\x1b[<${cb};${x};${y}M`);
    }
    case "scroll_up": {
      const cb = 64 | modBits;
      return ok(`\x1b[<${cb};${x};${y}M`);
    }
    case "scroll_down": {
      const cb = 65 | modBits;
      return ok(`\x1b[<${cb};${x};${y}M`);
    }
  }
}
