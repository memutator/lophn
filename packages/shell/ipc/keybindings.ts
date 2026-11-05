// 작업대 단축키 표 하나. key 판정과 바인딩이 모두 여기 있고, 받는 곳(main·renderer)도 이 표에 적는다.
// main(shortcuts.ts)은 `main`이 적힌 binding만, renderer(commands/keybinding-service.ts)는 표 전체를 받는다.
// main이 맞춘 binding은 id 글자(`tab.close`, `desk.nth:3`, `app.panel:<app>:<surface>`) 그대로 renderer로
// 가서 parseBindingId로 command와 arg가 된다. 표의 command 이름이 renderer command registry의 id다.
// `app.panel:*`은 표에 줄이 없고 사람이 단 키(overrides)에서만 생긴다(resolveBindings가 표 뒤에 붙인다).
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.
//
// chord는 "Ctrl+Shift+KeyT"처럼 modifier(Ctrl·Cmd·Alt·Shift)와 KeyboardEvent.code 하나다.
// 한글 입력기처럼 key가 글자가 아니어도 되도록 code로 판정하고, 글자 키는 배열이 달라도
// 같은 글자가 닿도록 key도 함께 본다. modifier는 정확히 같아야 맞는다(Ctrl+Alt+1은 Alt+1이 아니다).
//
// 터미널(xterm)에 focus가 있을 때: Linux·Windows에서 Ctrl+글자 하나(Ctrl+W·B·P·T·N·O)는 shell이 쓰므로
// 앱이 받지 않고 shell로 보낸다(VS Code의 commandsToSkipShell과 같은 생각). Ctrl+Shift+C·V는 터미널의
// 복사·붙여 넣기라 RESERVED에 둔다(renderer/terminal/xterm-view.ts). 나머지(Ctrl+Tab,
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
  | "tab.rename"
  | "tab.close-others"
  | "tab.close-right"
  | "tab.close-saved"
  | "tab.close-all"
  | "tab.keep-open"
  | "tab.copy-path"
  | "tab.copy-relative-path"
  | "tab.reveal"
  | "pane.split"
  | "pane.split-down"
  | "pane.focus"
  | "pane.focus-left"
  | "pane.focus-right"
  | "pane.focus-up"
  | "pane.focus-down"
  | "pane.swap-left"
  | "pane.swap-right"
  | "pane.swap-up"
  | "pane.swap-down"
  | "pane.stack-next"
  | "pane.stack-prev"
  | "pane.unstack"
  | "pane.remove"
  | "pane.unsplit"
  | "pane.close-others"
  | "pane.close-group"
  | "desk.new"
  | "desk.next"
  | "desk.prev"
  | "desk.nth"
  | "desk.rename"
  | "desk.close"
  | "tab.float"
  | "tab.detach"
  | "float.dock"
  | "float.minimize"
  | "new.terminal"
  | "new.browser"
  | "new.agent"
  | "new.document"
  | "search.open"
  | "files.quick-open"
  | "sidebar.toggle"
  | "explorer.focus"
  | "terminal.focus"
  | "sidebar.toggle-right"
  | "nav.back"
  | "nav.forward"
  | "settings.open"
  | "inbox.open"
  | "jobs.open"
  | "app.panel";

/** Settings가 묶는 단위. 표의 줄마다 하나다. */
export type KeySection =
  | "tab"
  | "pane"
  | "desk"
  | "float"
  | "open"
  | "view"
  | "app";

export type KeyPlatform = "mac" | "other";

export interface Binding {
  readonly command: Command;
  readonly section: KeySection;
  /**
   * tab.nth는 1~9와 0(마지막 탭), pane.focus는 고른 group의 leaf 번호(1부터), desk.nth는 1~9,
   * app.panel은 `<app>:<surface>`.
   */
  readonly arg?: number | string;
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

// 키가 없는 줄은 사람이 Settings에서 단다.
const NONE = { other: [], mac: [] } as const;

const DIRECTIONS = [
  ["left", "ArrowLeft"],
  ["right", "ArrowRight"],
  ["up", "ArrowUp"],
  ["down", "ArrowDown"],
] as const;

// group은 tab 2~4개다. 숫자는 고른 group의 leaf 순서(왼쪽·위에서부터)다.
const PANES = [1, 2, 3, 4];
// Alt+숫자는 macOS에서 Option 글자 입력이라 mac은 Ctrl+숫자다. 0은 마지막 탭.
const TAB_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const DESK_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// 표의 순서가 받는 순서다. 같은 키를 둘이 가지면 앞이 받는다.
export const KEYBINDINGS: readonly Binding[] = [
  { command: "tab.next", section: "tab", other: CYCLE, mac: CYCLE, main: BOTH },
  {
    command: "tab.prev",
    section: "tab",
    other: CYCLE_BACK,
    mac: CYCLE_BACK,
    main: BOTH,
  },
  ...TAB_NUMBERS.map(
    (arg): Binding => ({
      command: "tab.nth",
      section: "tab",
      arg,
      other: [`Alt+Digit${arg}`],
      mac: [`Ctrl+Digit${arg}`],
    }),
  ),
  {
    command: "tab.close",
    section: "tab",
    other: ["Ctrl+KeyW", "Ctrl+F4"],
    mac: ["Cmd+KeyW"],
    main: BOTH,
  },
  {
    command: "tab.reopen",
    section: "tab",
    other: ["Ctrl+Shift+KeyT"],
    mac: ["Cmd+Shift+KeyT"],
    main: BOTH,
  },
  {
    command: "tab.move-left",
    section: "tab",
    other: ["Ctrl+Shift+PageUp"],
    mac: ["Ctrl+Shift+PageUp"],
    main: BOTH,
  },
  {
    command: "tab.move-right",
    section: "tab",
    other: ["Ctrl+Shift+PageDown"],
    mac: ["Ctrl+Shift+PageDown"],
    main: BOTH,
  },
  { command: "tab.rename", section: "tab", ...NONE },
  { command: "tab.close-others", section: "tab", ...NONE },
  { command: "tab.close-right", section: "tab", ...NONE },
  { command: "tab.close-saved", section: "tab", ...NONE },
  { command: "tab.close-all", section: "tab", ...NONE },
  { command: "tab.keep-open", section: "tab", ...NONE },
  {
    command: "tab.copy-path",
    section: "tab",
    other: ["Alt+Shift+KeyC"],
    mac: ["Cmd+Alt+KeyC"],
  },
  {
    command: "tab.copy-relative-path",
    section: "tab",
    other: ["Ctrl+Alt+Shift+KeyC"],
    mac: ["Cmd+Alt+Shift+KeyC"],
  },
  { command: "tab.reveal", section: "tab", ...NONE },

  {
    command: "pane.split",
    section: "pane",
    other: ["Ctrl+Backslash"],
    mac: ["Cmd+Backslash"],
  },
  {
    command: "pane.split-down",
    section: "pane",
    other: ["Ctrl+Shift+Backslash"],
    mac: ["Cmd+Shift+Backslash"],
  },
  ...PANES.map(
    (arg): Binding => ({
      command: "pane.focus",
      section: "pane",
      arg,
      other: [`Ctrl+Digit${arg}`],
      mac: [`Cmd+Digit${arg}`],
    }),
  ),
  // 고른 group 안에서 방향으로 옮긴다. 편집기·터미널 안에서도 받는다(Ctrl+Alt+화살표는 shell의 Ctrl+글자가 아니다).
  ...DIRECTIONS.map(
    ([direction, key]): Binding => ({
      command: `pane.focus-${direction}`,
      section: "pane",
      other: [`Ctrl+Alt+${key}`],
      mac: [`Cmd+Alt+${key}`],
    }),
  ),
  ...DIRECTIONS.map(
    ([direction, key]): Binding => ({
      command: `pane.swap-${direction}`,
      section: "pane",
      other: [`Ctrl+Alt+Shift+${key}`],
      mac: [`Cmd+Alt+Shift+${key}`],
    }),
  ),
  {
    command: "pane.stack-next",
    section: "pane",
    other: ["Alt+PageDown"],
    mac: ["Alt+PageDown"],
  },
  {
    command: "pane.stack-prev",
    section: "pane",
    other: ["Alt+PageUp"],
    mac: ["Alt+PageUp"],
  },
  { command: "pane.unstack", section: "pane", ...NONE },
  { command: "pane.remove", section: "pane", ...NONE },
  { command: "pane.unsplit", section: "pane", ...NONE },
  { command: "pane.close-others", section: "pane", ...NONE },
  { command: "pane.close-group", section: "pane", ...NONE },

  {
    command: "desk.new",
    section: "desk",
    other: ["Ctrl+Shift+KeyN"],
    mac: ["Cmd+Shift+KeyN"],
  },
  {
    command: "desk.next",
    section: "desk",
    other: ["Ctrl+Alt+PageDown"],
    mac: ["Cmd+Alt+PageDown"],
    main: BOTH,
  },
  {
    command: "desk.prev",
    section: "desk",
    other: ["Ctrl+Alt+PageUp"],
    mac: ["Cmd+Alt+PageUp"],
    main: BOTH,
  },
  ...DESK_NUMBERS.map(
    (arg): Binding => ({
      command: "desk.nth",
      section: "desk",
      arg,
      other: [`Ctrl+Shift+Digit${arg}`],
      mac: [`Ctrl+Shift+Digit${arg}`],
      main: BOTH,
    }),
  ),
  { command: "desk.rename", section: "desk", ...NONE },
  { command: "desk.close", section: "desk", ...NONE },

  { command: "tab.float", section: "float", ...NONE },
  { command: "tab.detach", section: "float", ...NONE },
  { command: "float.dock", section: "float", ...NONE },
  { command: "float.minimize", section: "float", ...NONE },

  {
    command: "new.terminal",
    section: "open",
    other: ["Ctrl+Shift+Backquote"],
    mac: ["Ctrl+Shift+Backquote"],
  },
  {
    command: "new.browser",
    section: "open",
    other: ["Ctrl+KeyT"],
    mac: ["Cmd+KeyT"],
    main: BOTH,
  },
  {
    command: "new.agent",
    section: "open",
    other: ["Ctrl+KeyN"],
    mac: ["Cmd+KeyN"],
  },
  {
    command: "new.document",
    section: "open",
    other: ["Ctrl+KeyO"],
    mac: ["Cmd+KeyO"],
  },
  {
    command: "search.open",
    section: "open",
    other: ["Ctrl+Shift+KeyF"],
    mac: ["Cmd+Shift+KeyF"],
  },
  {
    command: "files.quick-open",
    section: "open",
    other: ["Ctrl+KeyP"],
    mac: ["Cmd+KeyP"],
  },

  {
    command: "sidebar.toggle",
    section: "view",
    other: ["Ctrl+KeyB"],
    mac: ["Cmd+KeyB"],
  },
  {
    command: "explorer.focus",
    section: "view",
    other: ["Ctrl+Shift+KeyE"],
    mac: ["Cmd+Shift+KeyE"],
  },
  {
    command: "terminal.focus",
    section: "view",
    other: ["Ctrl+Backquote"],
    mac: ["Ctrl+Backquote"],
  },
  {
    command: "sidebar.toggle-right",
    section: "view",
    other: ["Ctrl+Alt+KeyB"],
    mac: ["Cmd+Alt+KeyB"],
  },
  {
    command: "nav.back",
    section: "view",
    other: ["Ctrl+Alt+Minus"],
    mac: ["Ctrl+Minus"],
  },
  {
    command: "nav.forward",
    section: "view",
    other: ["Ctrl+Shift+Minus"],
    mac: ["Ctrl+Shift+Minus"],
  },
  {
    command: "settings.open",
    section: "view",
    other: ["Ctrl+Comma"],
    mac: ["Cmd+Comma"],
  },
  { command: "inbox.open", section: "view", ...NONE },
  { command: "jobs.open", section: "view", ...NONE },
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

/** 사람이 바꾼 키. binding id(`tab.close`, `tab.nth:1`, `app.panel:<app>:<surface>`) → 이 기기 platform의 chord. 표에 있는 id가 없으면 표의 키다. */
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

/** 앱 panel 화면을 여는 binding의 command. 표에 줄이 없고 사람이 단 키에서만 생긴다. */
export const APP_PANEL = "app.panel";

// app·surface는 `:`와 공백이 없는 글자다. 길이는 앱 id(30자)와 tab의 surface(80자)를 덮고 overrides key 상한(160)에 든다.
const APP_PANEL_ID = /^app\.panel:([^:\s]{1,64}):([^:\s]{1,80})$/;

export function appPanelBindingId(app: string, surface: string): string {
  return `${APP_PANEL}:${app}:${surface}`;
}

const TABLE_IDS = new Map(
  KEYBINDINGS.map((binding) => [bindingId(binding), binding] as const),
);

/** binding id를 command와 arg로. 표에 있는 id나 `app.panel:<app>:<surface>`(arg는 `<app>:<surface>`)만 받는다. */
export function parseBindingId(
  id: string,
): { command: Command; arg?: number | string } | null {
  const row = TABLE_IDS.get(id);
  if (row !== undefined) {
    return {
      command: row.command,
      ...(row.arg === undefined ? {} : { arg: row.arg }),
    };
  }
  const match = APP_PANEL_ID.exec(id);
  return match === null
    ? null
    : { command: APP_PANEL, arg: `${match[1]}:${match[2]}` };
}

const NAMED_KEYS =
  "Backquote|Backslash|BracketLeft|BracketRight|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|" +
  "ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End|Tab|Enter|Space|Escape|" +
  "Backspace|Delete|Insert";
const CHORD_TEXT = new RegExp(
  `^(?:(?:Ctrl|Cmd|Alt|Shift)\\+)*(?:Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|${NAMED_KEYS})$`,
);
const MAX_CHORDS = 4;

/** 받은 값에서 표에 있는 id(와 `app.panel:*`)와 읽을 수 있는 chord만 남긴다. 저장 파일이나 IPC 값이 틀려도 키가 죽지 않게. */
export function parseKeyOverrides(value: unknown): KeyOverrides {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, readonly string[]> = {};
  for (const [id, chords] of Object.entries(value)) {
    if (parseBindingId(id) === null || !Array.isArray(chords)) continue;
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

/**
 * 표에 사람이 바꾼 키를 덮은 바인딩. 덮는 것은 이 기기 platform의 chord뿐이다. 사람이 단 `app.panel:*`
 * 키는 표 뒤에 붙는다(main이 먼저 받고, 다른 platform의 chord는 비었다).
 */
export function resolveBindings(
  platform: KeyPlatform,
  overrides: KeyOverrides,
): readonly Binding[] {
  const apps = Object.entries(overrides).flatMap(([id, chords]): Binding[] => {
    const parsed = parseBindingId(id);
    if (parsed?.command !== APP_PANEL) return [];
    return [
      {
        command: APP_PANEL,
        section: "app",
        arg: parsed.arg,
        other: platform === "other" ? chords : [],
        mac: platform === "mac" ? chords : [],
        main: BOTH,
      },
    ];
  });
  return [
    ...KEYBINDINGS.map((binding) => {
      const chords = overrides[bindingId(binding)];
      return chords === undefined
        ? binding
        : { ...binding, [platform]: chords };
    }),
    ...apps,
  ];
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
  /** binding id. main이 renderer로 보내는 글자다. */
  readonly id: string;
  readonly command: Command;
  readonly arg?: number | string;
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
      id: bindingId(binding),
      command: binding.command,
      ...(binding.arg === undefined ? {} : { arg: binding.arg }),
      shell: shellOwns(chord, platform),
    };
  }
  return null;
}

/**
 * 이 표에 없는데 다른 곳이 먼저 쓰는 키. ipc/shortcuts.ts의 창 팔레트·런처와 전역 팔레트 키,
 * Linux·Windows 터미널의 복사·붙여 넣기(renderer/terminal/xterm-view.ts), OS와 글자 편집 키다. 표 키는
 * document capture에서 터미널·편집기보다 먼저 받으므로 여기 묶으면 복사·붙여 넣기가 죽는다.
 */
const RESERVED: Readonly<Record<KeyPlatform, readonly string[]>> = {
  mac: [
    "Cmd+KeyK",
    "Cmd+Shift+KeyL",
    "Cmd+Shift+KeyK",
    "Cmd+KeyA",
    "Cmd+KeyC",
    "Cmd+KeyV",
    "Cmd+KeyX",
    "Cmd+KeyZ",
    "Cmd+Shift+KeyZ",
    "Cmd+KeyQ",
    "Cmd+KeyH",
    "Cmd+KeyM",
    "Cmd+Tab",
    "Cmd+Space",
    "Cmd+Shift+Digit3",
    "Cmd+Shift+Digit4",
    "Cmd+Shift+Digit5",
  ],
  other: [
    "Ctrl+KeyK",
    "Ctrl+Shift+KeyL",
    "Ctrl+Shift+KeyK",
    "Ctrl+Shift+KeyC",
    "Ctrl+Shift+KeyV",
    "Ctrl+KeyA",
    "Ctrl+KeyC",
    "Ctrl+KeyV",
    "Ctrl+KeyX",
    "Ctrl+KeyZ",
    "Ctrl+KeyY",
    "Ctrl+Shift+KeyZ",
    "Alt+F4",
    "Alt+Tab",
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
  arg?: number | string,
  overrides: KeyOverrides = {},
): string | null {
  const found = resolveBindings(platform, overrides).find(
    (binding) => binding.command === command && binding.arg === arg,
  );
  const chord = found?.[platform][0];
  return chord === undefined ? null : chordLabel(chord, platform);
}

/** binding id의 첫 chord 이름. menu 항목 옆의 키 칸이 쓴다. 키가 없거나 모르는 id면 null이다. */
export function bindingLabel(
  id: string,
  platform: KeyPlatform,
  overrides: KeyOverrides,
): string | null {
  const found = resolveBindings(platform, overrides).find(
    (binding) => bindingId(binding) === id,
  );
  const chord = found?.[platform][0];
  return chord === undefined ? null : chordLabel(chord, platform);
}

export interface KeyConflict {
  /** 겹친 chord 글자(처음 만난 것). */
  readonly chord: string;
  /** 그 chord를 가진 binding id들(표 순서). RESERVED만 쓰는 키면 하나다. */
  readonly ids: readonly string[];
  /** 이 chord를 RESERVED도 쓴다. */
  readonly reserved: boolean;
}

/**
 * 이 platform에서 같은 chord를 가진 binding 묶음, 그리고 RESERVED와 같은 chord를 가진 binding.
 * 한 binding 안의 같은 chord 둘은 겹침이 아니다. 겹치면 표 순서가 앞인 binding이 받는다.
 */
export function findConflicts(
  platform: KeyPlatform,
  overrides: KeyOverrides,
): readonly KeyConflict[] {
  const groups: { chord: Chord; ids: string[]; reserved: boolean }[] = [];
  const groupOf = (chord: Chord) => {
    let group = groups.find((item) => sameChord(item.chord, chord));
    if (group === undefined) {
      group = { chord, ids: [], reserved: false };
      groups.push(group);
    }
    return group;
  };
  for (const binding of resolveBindings(platform, overrides)) {
    const id = bindingId(binding);
    for (const text of binding[platform]) {
      const group = groupOf(parseChord(text));
      if (!group.ids.includes(id)) group.ids.push(id);
    }
  }
  for (const text of RESERVED[platform])
    groupOf(parseChord(text)).reserved = true;
  return groups
    .filter((group) => group.ids.length >= (group.reserved ? 1 : 2))
    .map((group) => ({
      chord: group.chord.text,
      ids: group.ids,
      reserved: group.reserved,
    }));
}
