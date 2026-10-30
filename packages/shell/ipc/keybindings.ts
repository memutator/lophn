// 작업대 단축키 표 하나. key 판정과 바인딩이 모두 여기 있고, 받는 곳(main·renderer)도 이 표에 적는다.
// main(shortcuts.ts)은 `main`이 적힌 것만, renderer(commands/keybinding-service.ts)는 표 전체를 받는다.
// 표의 command 이름이 renderer command registry의 id다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.
//
// chord는 "Ctrl+Shift+KeyT"처럼 modifier(Ctrl·Cmd·Alt·Shift)와 KeyboardEvent.code 하나다.
// 한글 입력기처럼 key가 글자가 아니어도 되도록 code로 판정하고, 글자 키는 배열이 달라도
// 같은 글자가 닿도록 key도 함께 본다. modifier는 정확히 같아야 맞는다(Ctrl+Alt+1은 Alt+1이 아니다).
//
// 터미널(xterm)에 focus가 있을 때: Linux·Windows에서 Ctrl+글자 하나(Ctrl+W·B·P)는 shell이 쓰므로
// 앱이 받지 않고 shell로 보낸다(VS Code의 commandsToSkipShell과 같은 생각). Ctrl+Shift+C·V는 터미널의
// 복사·붙여 넣기라 이 표에 두지 않는다(renderer/terminal/xterm-view.ts). 나머지(Ctrl+Tab,
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
  | "pane.split-down"
  | "sidebar.toggle"
  | "explorer.focus"
  | "search.open"
  | "terminal.focus"
  | "files.quick-open";

/** main이 먼저 받아 renderer로 보내는 command. 표의 `main`이 적힌 것과 같아야 한다. */
export type MainCommand =
  | "tab.next"
  | "tab.prev"
  | "tab.close"
  | "tab.reopen"
  | "tab.move-left"
  | "tab.move-right";

export type KeyPlatform = "mac" | "other";

export interface Binding {
  readonly command: Command;
  /** tab.nth는 1~9와 0(마지막 탭), pane.focus는 칸 번호(1부터). */
  readonly arg?: number;
  /** Linux·Windows의 chord. */
  readonly other: readonly string[];
  /** macOS의 chord. */
  readonly mac: readonly string[];
  /**
   * main이 먼저 받는 platform. 두 이유다. (1) 앱 view·browser 탭 page에 focus가 있으면 키가
   * page로 가서 renderer의 keydown이 못 받는다. main의 before-input-event가 삼키고 renderer로
   * 보낸다(탭 이동·닫기·다시 열기는 Chrome처럼 page가 받지 않는다). (2) macOS는 menu key
   * equivalent(Cmd+W Close Window)가 page keydown보다 앞서서 renderer에서 preventDefault로는
   * 못 막는다. shell renderer 자신의 키는 Linux·Windows에서 renderer가 받는다(main/desktop/wiring).
   */
  readonly main?: readonly KeyPlatform[];
}

const BOTH: readonly KeyPlatform[] = ["mac", "other"];
const CYCLE = ["Ctrl+Tab", "Ctrl+PageDown"];
const CYCLE_BACK = ["Ctrl+Shift+Tab", "Ctrl+PageUp"];

const FIXED: readonly Binding[] = [
  { command: "tab.next", other: CYCLE, mac: CYCLE, main: BOTH },
  { command: "tab.prev", other: CYCLE_BACK, mac: CYCLE_BACK, main: BOTH },
  {
    command: "tab.close",
    other: ["Ctrl+KeyW", "Ctrl+F4"],
    mac: ["Cmd+KeyW"],
    main: BOTH,
  },
  {
    command: "tab.reopen",
    other: ["Ctrl+Shift+KeyT"],
    mac: ["Cmd+Shift+KeyT"],
    main: BOTH,
  },
  {
    command: "tab.move-left",
    other: ["Ctrl+Shift+PageUp"],
    mac: ["Ctrl+Shift+PageUp"],
    main: BOTH,
  },
  {
    command: "tab.move-right",
    other: ["Ctrl+Shift+PageDown"],
    mac: ["Ctrl+Shift+PageDown"],
    main: BOTH,
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
  {
    command: "pane.split-down",
    other: ["Ctrl+Shift+Backslash"],
    mac: ["Cmd+Shift+Backslash"],
  },
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

// 칸은 최대 여섯이다. 번호는 칸 순서(왼쪽·위에서 오른쪽·아래로)다.
const PANES = [1, 2, 3, 4, 5, 6];
// Alt+숫자는 macOS에서 Option 글자 입력이라 mac은 Ctrl+숫자다. 0은 마지막 탭.
const TAB_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

export const KEYBINDINGS: readonly Binding[] = [
  ...FIXED,
  ...TAB_NUMBERS.map(
    (arg): Binding => ({
      command: "tab.nth",
      arg,
      other: [`Alt+Digit${arg}`],
      mac: [`Ctrl+Digit${arg}`],
    }),
  ),
  ...PANES.map(
    (arg): Binding => ({
      command: "pane.focus",
      arg,
      other: [`Ctrl+Digit${arg}`],
      mac: [`Cmd+Digit${arg}`],
    }),
  ),
];

/** 판정할 수 있게 푼 chord 하나. renderer의 keybinding service도 같은 판정을 쓴다. */
export interface Chord {
  readonly text: string;
  readonly code: string;
  /** 글자 키는 배열이 달라도 닿도록 key도 본다. */
  readonly letter: string | null;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export function parseChord(text: string): Chord {
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

/** 사람이 바꾼 키. binding id(`tab.close`, `tab.nth:1`) → 이 기기 platform의 chord. 없는 id는 표의 키다. */
export type KeyOverrides = Readonly<Record<string, readonly string[]>>;

/** renderer가 사람이 바꾼 키를 main에 알리는 channel. main이 먼저 받는 키도 바뀐 키를 따른다. */
export const KEYBINDINGS_CHANNEL = "shell:keybindings";

export interface KeybindingsApi {
  set(overrides: KeyOverrides): void;
}

export function bindingId(binding: Binding): string {
  return binding.arg === undefined
    ? binding.command
    : `${binding.command}:${binding.arg}`;
}

const NAMED_KEYS =
  "Backquote|Backslash|BracketLeft|BracketRight|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|" +
  "ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End|Tab|Enter|Space|Escape|" +
  "Backspace|Delete|Insert";
const CHORD_TEXT = new RegExp(
  `^(?:(?:Ctrl|Cmd|Alt|Shift)\\+)*(?:Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|${NAMED_KEYS})$`,
);
const MAX_CHORDS = 4;

/** 받은 값에서 표에 있는 id와 읽을 수 있는 chord만 남긴다. 저장 파일이나 IPC 값이 틀려도 키가 죽지 않게. */
export function parseKeyOverrides(value: unknown): KeyOverrides {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const ids = new Set(KEYBINDINGS.map(bindingId));
  const out: Record<string, readonly string[]> = {};
  for (const [id, chords] of Object.entries(value)) {
    if (!ids.has(id) || !Array.isArray(chords)) continue;
    const valid = chords.filter(
      (chord): chord is string =>
        typeof chord === "string" && CHORD_TEXT.test(chord),
    );
    if (valid.length === chords.length && valid.length <= MAX_CHORDS) {
      out[id] = valid;
    }
  }
  return out;
}

/** 표에 사람이 바꾼 키를 덮은 바인딩. 덮는 것은 이 기기 platform의 chord뿐이다. */
export function resolveBindings(
  platform: KeyPlatform,
  overrides: KeyOverrides,
): readonly Binding[] {
  return KEYBINDINGS.map((binding) => {
    const chords = overrides[bindingId(binding)];
    return chords === undefined ? binding : { ...binding, [platform]: chords };
  });
}

export interface CompiledBindings {
  readonly list: readonly Compiled[];
}

export function compileBindings(
  bindings: readonly Binding[],
): CompiledBindings {
  return {
    list: bindings.map((binding) => ({
      binding,
      mac: binding.mac.map(parseChord),
      other: binding.other.map(parseChord),
    })),
  };
}

const COMPILED = compileBindings(KEYBINDINGS);

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

export function chordMatches(chord: Chord, input: KeyInput): boolean {
  if (
    chord.ctrl !== input.ctrl ||
    chord.meta !== input.meta ||
    chord.alt !== input.alt ||
    chord.shift !== input.shift
  )
    return false;
  if (input.code === chord.code) return true;
  return chord.letter !== null && input.key.toLowerCase() === chord.letter;
}

/** Ctrl 하나만 누른 글자 키. 터미널에 focus가 있으면 shell이 쓴다. macOS에서는 Cmd를 쓰므로 해당 없다. */
export function shellOwns(chord: Chord, platform: KeyPlatform): boolean {
  return (
    platform === "other" &&
    chord.letter !== null &&
    chord.ctrl &&
    !chord.alt &&
    !chord.shift &&
    !chord.meta
  );
}

/** 키 입력에 맞는 바인딩. `main`이면 main이 받는 것만 본다. 사람이 키를 바꿨으면 compiled로 그 표를 준다. */
export function matchKey(
  input: KeyInput,
  platform: KeyPlatform,
  only?: "main",
  compiled: CompiledBindings = COMPILED,
): KeyHit | null {
  for (const { binding, mac, other } of compiled.list) {
    if (only === "main" && !binding.main?.includes(platform)) continue;
    const chord = (platform === "mac" ? mac : other).find((item) =>
      chordMatches(item, input),
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

/**
 * 이 표에 없는데 다른 곳이 먼저 쓰는 키. ipc/shortcuts.ts의 창 팔레트·런처와 전역 팔레트 키, 그리고
 * Linux·Windows 터미널의 복사·붙여 넣기(renderer/terminal/xterm-view.ts)다. 표 키는 document capture에서
 * 터미널보다 먼저 받으므로 여기 묶으면 터미널 복사가 죽는다.
 */
const RESERVED: Readonly<Record<KeyPlatform, readonly string[]>> = {
  mac: ["Cmd+KeyK", "Cmd+Shift+KeyL", "Cmd+Shift+KeyK"],
  other: [
    "Ctrl+KeyK",
    "Ctrl+Shift+KeyL",
    "Ctrl+Shift+KeyK",
    "Ctrl+Shift+KeyC",
    "Ctrl+Shift+KeyV",
  ],
};

export type ChordCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "unsupported" | "needs_modifier" | "reserved";
    }
  | { readonly ok: false; readonly reason: "taken"; readonly by: Binding };

/** 두 chord가 같은 키 조합인가. 글자의 modifier 순서는 보지 않는다. */
export function sameChord(a: Chord, b: Chord): boolean {
  return (
    a.code === b.code &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

/**
 * 사람이 새로 고른 chord를 받을 수 있는가. own은 이 chord를 받을 binding id들이다(번호 줄은 번호마다 하나).
 * modifier 없는 키는 입력칸의 글자를 삼키고, 팔레트·런처 키는 main이 먼저 가져가며, 다른 바인딩과 같은
 * 키는 한쪽이 듣지 않는다.
 */
export function checkChord(
  text: string,
  own: readonly string[],
  platform: KeyPlatform,
  overrides: KeyOverrides,
): ChordCheck {
  if (!CHORD_TEXT.test(text)) return { ok: false, reason: "unsupported" };
  const chord = parseChord(text);
  const fKey = /^F([1-9]|1[0-2])$/.test(chord.code);
  if (!fKey && !chord.ctrl && !chord.meta && !chord.alt) {
    return { ok: false, reason: "needs_modifier" };
  }
  if (RESERVED[platform].some((one) => sameChord(parseChord(one), chord))) {
    return { ok: false, reason: "reserved" };
  }
  const by = resolveBindings(platform, overrides).find(
    (binding) =>
      !own.includes(bindingId(binding)) &&
      binding[platform].some((one) => sameChord(parseChord(one), chord)),
  );
  return by === undefined ? { ok: true } : { ok: false, reason: "taken", by };
}

export function isMainCommand(value: unknown): value is MainCommand {
  return KEYBINDINGS.some(
    (binding) => binding.command === value && binding.main !== undefined,
  );
}

const GLYPHS: Readonly<Record<string, string>> = {
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Minus: "-",
  Equal: "=",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const MODIFIER_CODES = /^(Control|Meta|Alt|Shift|OS)(Left|Right)?$/;

/**
 * Settings에서 누른 키를 chord 글자로. modifier만 누른 중이면 null이다. 물리 자리(code)로 적어
 * 한글 입력 상태나 배열이 달라도 같은 글자가 된다.
 */
export function chordOfInput(input: KeyInput): string | null {
  const code = input.code ?? "";
  if (code === "" || MODIFIER_CODES.test(code)) return null;
  return [
    ...(input.ctrl ? ["Ctrl"] : []),
    ...(input.meta ? ["Cmd"] : []),
    ...(input.alt ? ["Alt"] : []),
    ...(input.shift ? ["Shift"] : []),
    code,
  ].join("+");
}

function modifierParts(chord: Chord, platform: KeyPlatform): string[] {
  if (platform === "mac") {
    return [
      chord.ctrl ? "⌃" : "",
      chord.alt ? "⌥" : "",
      chord.shift ? "⇧" : "",
      chord.meta ? "⌘" : "",
    ].filter((part) => part !== "");
  }
  return [
    ...(chord.ctrl ? ["Ctrl"] : []),
    ...(chord.alt ? ["Alt"] : []),
    ...(chord.shift ? ["Shift"] : []),
  ];
}

/** 사람이 읽는 키 이름. macOS는 ⌃⌥⇧⌘ 기호를 붙여 쓰고 다른 OS는 Ctrl+Shift+처럼 +로 잇는다. */
export function chordLabel(text: string, platform: KeyPlatform): string {
  const chord = parseChord(text);
  const key = GLYPHS[chord.code] ?? chord.code.replace(/^(Key|Digit)/, "");
  const mods = modifierParts(chord, platform);
  return platform === "mac"
    ? `${mods.join("")}${key}`
    : [...mods, key].join("+");
}

/** modifier만의 이름(`Ctrl+Shift`, `⌃⇧`). 번호 줄처럼 끝 key가 정해지지 않은 키를 보일 때 쓴다. */
export function modifierLabel(modifier: string, platform: KeyPlatform): string {
  const mods = modifierParts(parseChord(`${modifier}+Digit0`), platform);
  return mods.join(platform === "mac" ? "" : "+");
}

/** command의 첫 chord 이름. 팔레트 행의 hint가 쓴다. */
export function commandLabel(
  command: Command,
  platform: KeyPlatform,
  arg?: number,
  overrides: KeyOverrides = {},
): string | null {
  const found = resolveBindings(platform, overrides).find(
    (binding) => binding.command === command && binding.arg === arg,
  );
  const chord = found?.[platform][0];
  return chord === undefined ? null : chordLabel(chord, platform);
}
