// The bytes a terminal keyboard sends: the key bar's keys and one typed character, with the one-shot Ctrl, Alt and
// Shift of the key bar (xterm's encoding: Ctrl turns a letter into its control code, Alt puts ESC before, modified arrows
// are `ESC [ 1 ; m X`).

export interface Mods {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export const NO_MODS: Mods = { ctrl: false, alt: false, shift: false };

export type BarKey = "escape" | "tab" | "enter" | "up" | "down" | "left" | "right";

const ARROW = { up: "A", down: "B", right: "C", left: "D" } as const;

/** One key of the bar with the armed modifiers. */
export function barKeyBytes(key: BarKey, mods: Mods): string {
  const alt = mods.alt ? "\x1b" : "";
  if (key === "escape") return `${alt}\x1b`;
  if (key === "enter") return `${alt}\r`;
  if (key === "tab") return mods.shift ? "\x1b[Z" : `${alt}\t`;
  const m = 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
  return m === 1 ? `\x1b[${ARROW[key]}` : `\x1b[1;${m}${ARROW[key]}`;
}

/** One typed character with the armed modifiers. */
export function charBytes(char: string, mods: Mods): string {
  let out = mods.shift ? char.toUpperCase() : char;
  if (mods.ctrl) {
    if (out === "?") out = "\x7f";
    else if (out === " ") out = "\x00";
    else if (/^[@A-Za-z[\\\]^_]$/.test(out)) {
      out = String.fromCharCode(out.toUpperCase().charCodeAt(0) & 0x1f);
    }
  }
  return mods.alt ? `\x1b${out}` : out;
}
