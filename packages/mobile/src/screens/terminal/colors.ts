// A terminal run's color on the phone: `#rrggbb` as it is, a palette number (`p0`~`p255`) through the xterm table. The
// first 16 are the desktop terminal's ANSI colors for the scheme (tokens `terminal`), so a screen reads the same as the
// tab on the computer; above them are xterm's 6×6×6 cube and 24 grays (the same table as the desktop's xterm-view.ts).
import { tokens } from "../../../../design/tokens.ts";

type Scheme = "light" | "dark";

// Palette 0~15 in order.
const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;
const CUBE = [0, 95, 135, 175, 215, 255];

const hex = (r: number, g: number, b: number) =>
  `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;

function paletteColor(index: number, scheme: Scheme): string {
  if (index < 16) return tokens.terminal[ANSI[index]!][scheme];
  if (index < 232) {
    const i = index - 16;
    return hex(CUBE[Math.floor(i / 36)]!, CUBE[Math.floor(i / 6) % 6]!, CUBE[i % 6]!);
  }
  const gray = 8 + (index - 232) * 10;
  return hex(gray, gray, gray);
}

/** The color a run names, or undefined for the default. */
export function terminalColor(
  color: string | undefined,
  scheme: Scheme,
): string | undefined {
  if (color === undefined) return undefined;
  return color.startsWith("p")
    ? paletteColor(Number(color.slice(1)), scheme)
    : color;
}
