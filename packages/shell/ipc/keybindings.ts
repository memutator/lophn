// 작업대 단축키 표 하나. key 판정과 바인딩이 모두 여기 있고, 받는 곳(main·renderer)도 이 표에 적는다.
// main(shortcuts.ts)은 `main`이 적힌 것만, renderer(workspace/use-keybindings.ts)는 나머지를 받는다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.
//
// chord는 "Ctrl+Shift+KeyT"처럼 modifier(Ctrl·Cmd·Alt·Shift)와 KeyboardEvent.code 하나다.
// 한글 입력기처럼 key가 글자가 아니어도 되도록 code로 판정하고, 글자 키는 배열이 달라도
// 같은 글자가 닿도록 key도 함께 본다. modifier는 정확히 같아야 맞는다(Ctrl+Alt+1은 Alt+1이 아니다).
//
// 터미널(xterm)에 focus가 있을 때: Linux·Windows에서 Ctrl+글자 하나(Ctrl+W·B·P)는 shell이 쓰므로
// 앱이 받지 않고 shell로 보낸다(VS Code의 commandsToSkipShell과 같은 생각). 나머지(Ctrl+Tab,
// Ctrl+PageUp/Down, Alt+숫자, Ctrl+숫자, Ctrl+Shift+글자, Ctrl+`, Ctrl+\)는 앱이 받는다.
// macOS의 Cmd 조합은 shell과 겹치지 않아 모두 앱이 받는다.

export type Command =
  | "tab.next"
  | "tab.prev"
  | "tab.nth"
  | "tab.close"
  | "tab.reopen"
  | "tab.move-left"
  | "tab.move-right"
  | "tab.to-prev-pane"
  | "tab.to-next-pane"
  | "pane.focus"
  | "pane.split"
  | "sidebar.toggle"
  | "explorer.focus"
  | "search.open"
  | "terminal.focus"
  | "files.quick-open";

/** main이 먼저 받아 renderer로 보내는 command. 표의 `main`이 적힌 것과 같아야 한다. */
export type MainCommand = "tab.close";

export type KeyPlatform = "mac" | "other";

interface Binding {
  readonly command: Command;
  /** tab.nth는 1~9와 0(마지막 탭), pane.focus는 칸 번호(1부터). */
  readonly arg?: number;
  /** Linux·Windows의 chord. */
  readonly other: readonly string[];
  /** macOS의 chord. */
  readonly mac: readonly string[];
  /**
   * Electron 기본 menu가 page보다 먼저 가져가는 platform. macOS는 menu key equivalent(Cmd+W
   * Close Window)가 page keydown보다 앞서서 renderer에서 preventDefault로는 못 막는다.
   * main의 before-input-event가 menu 단축키까지 막는다. Linux·Windows는 page가 preventDefault하면
   * menu에 가지 않고, 터미널의 Ctrl+W를 shell로 보내야 해서 renderer가 받는다.
   */
  readonly main?: readonly KeyPlatform[];
}

const CYCLE = ["Ctrl+Tab", "Ctrl+PageDown"];
const CYCLE_BACK = ["Ctrl+Shift+Tab", "Ctrl+PageUp"];

const FIXED: readonly Binding[] = [
  { command: "tab.next", other: CYCLE, mac: CYCLE },
  { command: "tab.prev", other: CYCLE_BACK, mac: CYCLE_BACK },
  {
    command: "tab.close",
    other: ["Ctrl+KeyW", "Ctrl+F4"],
    mac: ["Cmd+KeyW"],
    main: ["mac"],
  },
  {
    command: "tab.reopen",
    other: ["Ctrl+Shift+KeyT"],
    mac: ["Cmd+Shift+KeyT"],
  },
  {
    command: "tab.move-left",
    other: ["Ctrl+Shift+PageUp"],
    mac: ["Ctrl+Shift+PageUp"],
  },
  {
    command: "tab.move-right",
    other: ["Ctrl+Shift+PageDown"],
    mac: ["Ctrl+Shift+PageDown"],
  },
  {
    command: "tab.to-prev-pane",
    other: ["Ctrl+Alt+ArrowLeft"],
    mac: ["Cmd+Ctrl+ArrowLeft"],
  },
  {
    command: "tab.to-next-pane",
    other: ["Ctrl+Alt+ArrowRight"],
    mac: ["Cmd+Ctrl+ArrowRight"],
  },
  { command: "pane.split", other: ["Ctrl+Backslash"], mac: ["Cmd+Backslash"] },
  { command: "sidebar.toggle", other: ["Ctrl+KeyB"], mac: ["Cmd+KeyB"] },
  {
    command: "explorer.focus",
    other: ["Ctrl+Shift+KeyE"],
    mac: ["Cmd+Shift+KeyE"],
  },
  {
    command: "search.open",
    other: ["Ctrl+Shift+KeyF"],
    mac: ["Cmd+Shift+KeyF"],
  },
  {
    command: "terminal.focus",
    other: ["Ctrl+Backquote"],
    mac: ["Ctrl+Backquote"],
  },
  { command: "files.quick-open", other: ["Ctrl+KeyP"], mac: ["Cmd+KeyP"] },
];

// 칸은 최대 둘이다. 셋째 칸 번호는 두지 않는다.
const PANES = [1, 2];
// Alt+숫자는 macOS에서 Option 글자 입력이라 mac은 Ctrl+숫자다. 0은 마지막 탭.
const TAB_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

export const KEYBINDINGS: readonly Binding[] = [
  ...FIXED,
  ...TAB_NUMBERS.map((arg): Binding => ({
    command: "tab.nth",
    arg,
    other: [`Alt+Digit${arg}`],
    mac: [`Ctrl+Digit${arg}`],
  })),
  ...PANES.map((arg): Binding => ({
    command: "pane.focus",
    arg,
    other: [`Ctrl+Digit${arg}`],
    mac: [`Cmd+Digit${arg}`],
  })),
];

interface Chord {
  readonly text: string;
  readonly code: string;
  /** 글자 키는 배열이 달라도 닿도록 key도 본다. */
  readonly letter: string | null;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

function parse(text: string): Chord {
  const parts = text.split("+");
  const code = parts.at(-1)!;
  const mods = parts.slice(0, -1);
  return {
    text,
    code,
    letter: /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : null,
    ctrl: mods.includes("Ctrl"),
    meta: mods.includes("Cmd"),
    alt: mods.includes("Alt"),
    shift: mods.includes("Shift"),
  };
}

interface Compiled {
  readonly binding: Binding;
  readonly mac: readonly Chord[];
  readonly other: readonly Chord[];
}

const COMPILED: readonly Compiled[] = KEYBINDINGS.map((binding) => ({
  binding,
  mac: binding.mac.map(parse),
  other: binding.other.map(parse),
}));

/** DOM KeyboardEvent와 Electron Input에서 같은 모양으로 옮긴 키 입력. */
export interface KeyInput {
  readonly key: string;
  readonly code?: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface KeyHit {
  readonly command: Command;
  readonly arg?: number;
  /** Linux·Windows의 Ctrl+글자 하나. 터미널에 focus가 있으면 shell이 쓴다. */
  readonly shell: boolean;
}

function chordMatches(chord: Chord, input: KeyInput): boolean {
  if (
    chord.ctrl !== input.ctrl || chord.meta !== input.meta ||
    chord.alt !== input.alt || chord.shift !== input.shift
  ) return false;
  if (input.code === chord.code) return true;
  return chord.letter !== null && input.key.toLowerCase() === chord.letter;
}

// Ctrl 하나만 누른 글자 키. macOS에서는 Cmd를 쓰므로 해당 없다.
function shellOwns(chord: Chord, platform: KeyPlatform): boolean {
  return platform === "other" && chord.letter !== null && chord.ctrl &&
    !chord.alt && !chord.shift && !chord.meta;
}

/** 키 입력에 맞는 바인딩. `main`이면 main이 받는 것만 본다. */
export function matchKey(
  input: KeyInput,
  platform: KeyPlatform,
  only?: "main",
): KeyHit | null {
  for (const { binding, mac, other } of COMPILED) {
    if (only === "main" && !binding.main?.includes(platform)) continue;
    const chord = (platform === "mac" ? mac : other).find((item) =>
      chordMatches(item, input)
    );
    if (chord === undefined) continue;
    return {
      command: binding.command,
      ...(binding.arg === undefined ? {} : { arg: binding.arg }),
      shell: shellOwns(chord, platform),
    };
  }
  return null;
}

export function isMainCommand(value: unknown): value is MainCommand {
  return KEYBINDINGS.some((binding) =>
    binding.command === value && binding.main !== undefined
  );
}

const GLYPHS: Readonly<Record<string, string>> = {
  Backquote: "`",
  Backslash: "\\",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** 사람이 읽는 키 이름. macOS는 ⌃⌥⇧⌘ 기호를 붙여 쓰고 다른 OS는 Ctrl+Shift+처럼 +로 잇는다. */
function chordLabel(chord: Chord, platform: KeyPlatform): string {
  const key = GLYPHS[chord.code] ??
    chord.code.replace(/^(Key|Digit)/, "");
  if (platform === "mac") {
    return `${chord.ctrl ? "⌃" : ""}${chord.alt ? "⌥" : ""}${
      chord.shift ? "⇧" : ""
    }${chord.meta ? "⌘" : ""}${key}`;
  }
  return [
    ...(chord.ctrl ? ["Ctrl"] : []),
    ...(chord.alt ? ["Alt"] : []),
    ...(chord.shift ? ["Shift"] : []),
    key,
  ].join("+");
}

/** command의 첫 chord 이름. 팔레트 행의 hint가 쓴다. */
export function commandLabel(
  command: Command,
  platform: KeyPlatform,
  arg?: number,
): string | null {
  const found = COMPILED.find(({ binding }) =>
    binding.command === command && binding.arg === arg
  );
  const chord = found?.[platform][0];
  return chord === undefined ? null : chordLabel(chord, platform);
}
