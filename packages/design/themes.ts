// 색 theme. theme 하나는 한 모드(light 또는 dark)의 색 token 전부다. 사람은 light용과 dark용을 따로 고르고,
// accent는 그 위에 hex 하나로 덮는다(accentColors가 나머지 ink·focus·selection 색을 만든다).
// 내장 theme은 여기 있고, 사람·agent가 쓴 theme file(`<data root>/themes/<id>.json`)은 loadThemes가 읽는다.
// theme file 모양: { "name"?, "mode"?: "light"|"dark", "extends"?: <theme id>, "colors": { "<token 경로>": "<hex>" } }.
// 빠진 색은 extends의 theme, 없으면 같은 모드의 기본 theme에서 온다. mode는 extends가 있으면 그것을 따른다.
import {
  contrast,
  isHexColor,
  mix,
  moveLightness,
  shiftLightness,
} from "./color.ts";
import { flatten } from "./flatten.ts";
import { type Theme as Mode, type Themed } from "./tokens.ts";

export type { Mode };

/** token 경로(`color.surface.base`) → hex. */
export type ThemeColors = Readonly<Record<string, string>>;

export type ThemeProblem =
  | { readonly kind: "unknown_path"; readonly path: string }
  | { readonly kind: "bad_value"; readonly path: string }
  | ContrastProblem;

export interface ContrastProblem {
  readonly kind: "contrast";
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly minimum: number;
}

export interface ColorTheme {
  readonly id: string;
  readonly name: string;
  readonly mode: Mode;
  readonly builtIn: boolean;
  /** THEME_PATHS 전부. */
  readonly colors: ThemeColors;
  /** theme file의 문제. 문제가 있어도 theme은 쓸 수 있다(틀린 값은 상속 값). 내장 theme은 비어 있다. */
  readonly problems: readonly ThemeProblem[];
}

export type BrokenReason =
  | "bad_id"
  | "too_large"
  | "not_json"
  | "bad_shape"
  | "no_mode"
  | "unknown_extends"
  | "extends_cycle"
  | "id_taken";

/** theme으로 쓸 수 없는 file. */
export interface BrokenTheme {
  readonly id: string;
  readonly reason: BrokenReason;
}

export interface ThemeFile {
  /** file 이름에서 `.json`을 뺀 것. */
  readonly id: string;
  readonly text: string;
}

export interface Themes {
  readonly list: readonly ColorTheme[];
  readonly broken: readonly BrokenTheme[];
}

// file icon은 식별 색이고, 창 닫기 단추는 OS 모양이고, 그림자·backdrop은 hex가 아니라서 theme이 덮지 않는다.
const NOT_THEMED = new Set(["fileIcon", "window", "shadow"]);
const themed = flatten().filter(
  (token) =>
    token.dark !== undefined &&
    !NOT_THEMED.has(token.path[0]!) &&
    isHexColor(token.light) &&
    isHexColor(token.dark),
);

/** theme이 덮는 token 경로. */
export const THEME_PATHS: readonly string[] = themed.map((token) =>
  token.path.join("."),
);
const KNOWN = new Set(THEME_PATHS);

/** token 정의(tokens.ts)의 색. 기본 theme(warm)과 같다. */
export const DEFAULT_COLORS: Readonly<Record<Mode, ThemeColors>> = {
  light: Object.fromEntries(themed.map((t) => [t.path.join("."), t.light])),
  dark: Object.fromEntries(themed.map((t) => [t.path.join("."), t.dark!])),
};

export const DEFAULT_THEMES: Readonly<Record<Mode, string>> = {
  light: "warm-light",
  dark: "warm-dark",
};

const THEME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** theme id로 쓸 수 있는가. 설정 값과 file 이름이 이 규칙을 따른다. */
export function isThemeId(value: unknown): value is string {
  return typeof value === "string" && THEME_ID.test(value);
}

const SURFACES = [
  "color.surface.floor",
  "color.surface.base",
  "color.surface.subtle",
  "color.surface.muted",
  "color.surface.shell",
  "tabStrip.bar",
  "floating.surface",
];

/**
 * 대비가 모자란 짝. 글자는 모든 바탕과 4.5:1, focus는 모든 바탕과 3:1, 고른 행·soft 위 글자, ink·danger
 * 단추의 글자, code token(code block 바탕 subtle과 base), status 글자, link를 본다.
 */
export function contrastProblems(colors: ThemeColors): ContrastProblem[] {
  const problems: ContrastProblem[] = [];
  const check = (foreground: string, background: string, minimum: number) => {
    const ratio = contrast(colors[foreground]!, colors[background]!);
    if (ratio < minimum) {
      problems.push({
        kind: "contrast",
        foreground,
        background,
        ratio: Math.round(ratio * 100) / 100,
        minimum,
      });
    }
  };
  for (const text of [
    "color.text.primary",
    "color.text.secondary",
    "color.text.muted",
  ]) {
    for (const surface of SURFACES) check(text, surface, 4.5);
  }
  for (const surface of SURFACES) check("color.focus", surface, 3);
  check("color.text.primary", "color.selection", 4.5);
  check("color.text.primary", "color.ink.soft", 4.5);
  check("color.ink.text", "color.ink.background", 4.5);
  check("color.ink.text", "color.ink.hover", 4.5);
  check("color.danger.text", "color.danger.background", 4.5);
  check("color.danger.text", "color.danger.hover", 4.5);
  for (const path of THEME_PATHS.filter((p) => p.startsWith("code."))) {
    check(path, "color.surface.subtle", 4.5);
    check(path, "color.surface.base", 4.5);
  }
  for (const tone of ["good", "warning", "serious", "critical", "neutral"]) {
    check(`status.${tone}.text`, "color.surface.base", 4.5);
  }
  check("color.link", "color.surface.base", 4.5);
  return problems;
}

/**
 * accent hex 하나로 ink(주 단추·고른 표시)·focus·selection 색을 만든다. 대비가 모자라면 색상은 두고 명도만
 * 옮긴다: ink 바탕은 카드 바탕과 3:1, ink 글자와 4.5:1, focus는 모든 바탕과 3:1, selection·soft 위 글자 4.5:1.
 */
export function accentColors(
  seed: string,
  colors: ThemeColors,
  mode: Mode,
): Record<string, string> {
  const base = colors["color.surface.base"]!;
  const text = colors["color.text.primary"]!;
  // 바탕에서 멀어지는 방향. light는 어둡게, dark는 밝게.
  const away = mode === "light" ? -1 : 1;
  // 바탕 쪽 글자(light의 흰 바탕색, dark의 어두운 바탕색)와 그 반대 쪽 글자.
  const nearInk = base;
  const farInk = text;
  let background = moveLightness(seed, away, (c) => contrast(c, base) >= 3);
  let inkText =
    contrast(background, nearInk) >= contrast(background, farInk)
      ? nearInk
      : farInk;
  if (contrast(background, inkText) < 4.5) {
    // 바탕에서 멀어지면 바탕 쪽 글자와의 대비가 커진다. 카드 바탕과의 3:1도 그대로다.
    inkText = nearInk;
    background = moveLightness(
      background,
      away,
      (c) => contrast(c, inkText) >= 4.5,
    );
  }
  // hover는 글자에서 한 걸음 더 멀어져 대비가 줄지 않는다.
  const fromText = inkText === nearInk ? away : -away;
  const hover = shiftLightness(background, fromText * 0.06);
  const surfaces = SURFACES.map((path) => colors[path]!);
  const focus = moveLightness(seed, away, (c) =>
    surfaces.every((surface) => contrast(c, surface) >= 3),
  );
  const tint = (start: number) => {
    for (let t = start; t > 0; t -= 0.02) {
      const candidate = mix(base, seed, t);
      if (contrast(candidate, text) >= 4.5) return candidate;
    }
    return base;
  };
  return {
    "color.ink.background": background,
    "color.ink.text": inkText,
    "color.ink.hover": hover,
    "color.ink.soft": tint(mode === "light" ? 0.2 : 0.3),
    "color.focus": focus,
    "color.selection": tint(mode === "light" ? 0.12 : 0.18),
  };
}

interface ThemeSource {
  readonly id: string;
  readonly name: string;
  readonly mode: Mode;
  readonly colors: ThemeColors;
}

const pick = (pairs: Record<string, Themed>, mode: Mode): ThemeColors =>
  Object.fromEntries(
    Object.entries(pairs).map(([path, pair]) => [path, pair[mode]]),
  );

const pair = (light: string, dark: string): Themed => ({ light, dark });

// 옛 background preset(neutral, cool)의 색. surface·border·text와 그에 맞춘 code 글자·탭 줄·떠 있는 표면이다.
const neutral = {
  "color.surface.floor": pair("#f8f8f8", "#0d0d0d"),
  "color.surface.base": pair("#ffffff", "#161616"),
  "color.surface.subtle": pair("#f2f2f2", "#1d1d1d"),
  "color.surface.muted": pair("#eaeaea", "#252525"),
  "color.surface.shell": pair("#f2f2f2", "#0d0d0d"),
  "color.border.subtle": pair("#e6e6e6", "#232323"),
  "color.border.base": pair("#dedede", "#2c2c2c"),
  "color.border.strong": pair("#c0c0c0", "#444444"),
  "color.text.primary": pair("#1a1a1a", "#f2f2f2"),
  "color.text.secondary": pair("#525252", "#c2c2c2"),
  "color.text.muted": pair("#686868", "#969696"),
  "color.text.disabled": pair("#a3a3a3", "#5e5e5e"),
  "code.foreground": pair("#1a1a1a", "#f2f2f2"),
  "tabStrip.bar": pair("#f2f2f2", "#0d0d0d"),
  "tabStrip.hover": pair("#eaeaea", "#1d1d1d"),
  "floating.surface": pair("#ffffff", "#1d1d1d"),
  "floating.hover": pair("#f2f2f2", "#2a2a2a"),
};

const cool = {
  "color.surface.floor": pair("#f6f8fa", "#0b0e12"),
  "color.surface.base": pair("#ffffff", "#12161c"),
  "color.surface.subtle": pair("#eff2f6", "#1a1f26"),
  "color.surface.muted": pair("#e6eaf0", "#232932"),
  "color.surface.shell": pair("#eff2f6", "#0b0e12"),
  "color.border.subtle": pair("#e3e8ee", "#1f252d"),
  "color.border.base": pair("#dbe1e9", "#2a313b"),
  "color.border.strong": pair("#bbc4d0", "#414a57"),
  "color.text.primary": pair("#161a20", "#eef1f5"),
  "color.text.secondary": pair("#4a5361", "#bcc4cf"),
  "color.text.muted": pair("#5c6676", "#8d97a5"),
  "color.text.disabled": pair("#9ca5b3", "#596270"),
  "code.foreground": pair("#161a20", "#eef1f5"),
  "tabStrip.bar": pair("#eff2f6", "#0b0e12"),
  "tabStrip.hover": pair("#e6eaf0", "#1a1f26"),
  "floating.surface": pair("#ffffff", "#1a1f26"),
  "floating.hover": pair("#eff2f6", "#272d36"),
};

// Tokyo Night(enkia, folke/tokyonight.nvim의 night). 글자·comment는 대비 4.5:1에 맞춰 조금 밝혔다.
const tokyoNight: ThemeColors = {
  "color.surface.floor": "#16161e",
  "color.surface.base": "#1a1b26",
  "color.surface.subtle": "#1f2335",
  "color.surface.muted": "#292e42",
  "color.surface.shell": "#16161e",
  "color.border.subtle": "#202231",
  "color.border.base": "#292e42",
  "color.border.strong": "#3b4261",
  "color.text.primary": "#c0caf5",
  "color.text.secondary": "#a9b1d6",
  "color.text.muted": "#8f97c4",
  "color.text.disabled": "#545c7e",
  "color.ink.background": "#7aa2f7",
  "color.ink.text": "#16161e",
  "color.ink.hover": "#93b4f8",
  "color.ink.soft": "#2f3b62",
  "color.link": "#7dcfff",
  "color.focus": "#7aa2f7",
  "color.selection": "#283457",
  "color.danger.background": "#c53b53",
  "color.danger.text": "#ffffff",
  "color.danger.hover": "#a83246",
  "status.good.marker": "#9ece6a",
  "status.good.text": "#9ece6a",
  "status.warning.marker": "#e0af68",
  "status.warning.text": "#e0af68",
  "status.serious.marker": "#ff9e64",
  "status.serious.text": "#ff9e64",
  "status.critical.marker": "#f7768e",
  "status.critical.text": "#f7768e",
  "status.neutral.marker": "#565f89",
  "status.neutral.text": "#a9b1d6",
  "chart.series.0": "#7aa2f7",
  "chart.series.1": "#ff9e64",
  "chart.series.2": "#73daca",
  "chart.series.3": "#e0af68",
  "chart.series.4": "#f7768e",
  "chart.series.5": "#9ece6a",
  "chart.series.6": "#bb9af7",
  "chart.series.7": "#db4b4b",
  "chart.other": "#565f89",
  "diff.addLine": "#20303b",
  "diff.addWord": "#2a4a52",
  "diff.deleteLine": "#37222c",
  "diff.deleteWord": "#5a2a36",
  "tabStrip.bar": "#16161e",
  "tabStrip.hover": "#1f2335",
  "terminal.black": "#15161e",
  "terminal.red": "#f7768e",
  "terminal.green": "#9ece6a",
  "terminal.yellow": "#e0af68",
  "terminal.blue": "#7aa2f7",
  "terminal.magenta": "#bb9af7",
  "terminal.cyan": "#7dcfff",
  "terminal.white": "#a9b1d6",
  "terminal.brightBlack": "#414868",
  "terminal.brightRed": "#f7768e",
  "terminal.brightGreen": "#9ece6a",
  "terminal.brightYellow": "#e0af68",
  "terminal.brightBlue": "#7aa2f7",
  "terminal.brightMagenta": "#bb9af7",
  "terminal.brightCyan": "#7dcfff",
  "terminal.brightWhite": "#c0caf5",
  "code.foreground": "#c0caf5",
  "code.token.constant": "#ff9e64",
  "code.token.string": "#9ece6a",
  "code.token.comment": "#8189b5",
  "code.token.keyword": "#bb9af7",
  "code.token.parameter": "#e0af68",
  "code.token.function": "#7aa2f7",
  "code.token.stringExpression": "#7dcfff",
  "code.token.punctuation": "#89ddff",
  "code.token.link": "#73daca",
  "code.token.inserted": "#9ece6a",
  "code.token.deleted": "#f7768e",
  "code.token.changed": "#7aa2f7",
  "floating.surface": "#1f2335",
  "floating.hover": "#292e42",
};

// Tokyo Night Day. 원래 판의 옅은 색(comment, 노랑)은 흰 바탕 대비 4.5:1에 맞춰 어둡게 했다.
const tokyoNightDay: ThemeColors = {
  "color.surface.floor": "#d6d8e2",
  "color.surface.base": "#e9e9ed",
  "color.surface.subtle": "#e1e2e7",
  "color.surface.muted": "#d6d8e2",
  "color.surface.shell": "#d6d8e2",
  "color.border.subtle": "#d6d8e2",
  "color.border.base": "#c8cbda",
  "color.border.strong": "#a8aecb",
  "color.text.primary": "#343b58",
  "color.text.secondary": "#3c4675",
  "color.text.muted": "#4e5683",
  "color.text.disabled": "#9699b7",
  "color.ink.background": "#2e5fc9",
  "color.ink.text": "#ffffff",
  "color.ink.hover": "#244fae",
  "color.ink.soft": "#c5d0ec",
  "color.link": "#2a5bc2",
  "color.focus": "#2e5fc9",
  "color.selection": "#cfd6ee",
  "color.danger.background": "#b63a3a",
  "color.danger.text": "#ffffff",
  "color.danger.hover": "#9c3030",
  "status.good.marker": "#587539",
  "status.good.text": "#445b2c",
  "status.warning.marker": "#c49a3c",
  "status.warning.text": "#6d5230",
  "status.serious.marker": "#b15c00",
  "status.serious.text": "#8c4900",
  "status.critical.marker": "#f52a65",
  "status.critical.text": "#a8323a",
  "status.neutral.marker": "#8990b3",
  "status.neutral.text": "#3c4675",
  "chart.series.0": "#2e7de9",
  "chart.series.1": "#b15c00",
  "chart.series.2": "#118c74",
  "chart.series.3": "#8c6c3e",
  "chart.series.4": "#d20065",
  "chart.series.5": "#587539",
  "chart.series.6": "#7847bd",
  "chart.series.7": "#c64343",
  "chart.other": "#a8aecb",
  "diff.addLine": "#d9e6d3",
  "diff.addWord": "#bcd5b1",
  "diff.deleteLine": "#f0d8dd",
  "diff.deleteWord": "#e3b2bc",
  "tabStrip.bar": "#d6d8e2",
  "tabStrip.hover": "#c8cbda",
  "terminal.black": "#343b58",
  "terminal.red": "#f52a65",
  "terminal.green": "#587539",
  "terminal.yellow": "#8c6c3e",
  "terminal.blue": "#2e7de9",
  "terminal.magenta": "#9854f1",
  "terminal.cyan": "#007197",
  "terminal.white": "#6172b0",
  "terminal.brightBlack": "#a1a6c5",
  "terminal.brightRed": "#f52a65",
  "terminal.brightGreen": "#587539",
  "terminal.brightYellow": "#8c6c3e",
  "terminal.brightBlue": "#2e7de9",
  "terminal.brightMagenta": "#9854f1",
  "terminal.brightCyan": "#007197",
  "terminal.brightWhite": "#3760bf",
  "code.foreground": "#343b58",
  "code.token.constant": "#934d00",
  "code.token.string": "#4a6330",
  "code.token.comment": "#5a6291",
  "code.token.keyword": "#7a3ed6",
  "code.token.parameter": "#6d5230",
  "code.token.function": "#2559c0",
  "code.token.stringExpression": "#006080",
  "code.token.punctuation": "#005a70",
  "code.token.link": "#2e5f58",
  "code.token.inserted": "#4a6330",
  "code.token.deleted": "#a8323a",
  "code.token.changed": "#2559c0",
  "floating.surface": "#e9e9ed",
  "floating.hover": "#d6d8e2",
};

const SOURCES: readonly ThemeSource[] = [
  { id: "warm-light", name: "Warm", mode: "light", colors: {} },
  {
    id: "neutral-light",
    name: "Neutral",
    mode: "light",
    colors: pick(neutral, "light"),
  },
  {
    id: "cool-light",
    name: "Cool",
    mode: "light",
    colors: pick(cool, "light"),
  },
  {
    id: "tokyo-night-day",
    name: "Tokyo Night Day",
    mode: "light",
    colors: tokyoNightDay,
  },
  { id: "warm-dark", name: "Warm", mode: "dark", colors: {} },
  {
    id: "neutral-dark",
    name: "Neutral",
    mode: "dark",
    colors: pick(neutral, "dark"),
  },
  { id: "cool-dark", name: "Cool", mode: "dark", colors: pick(cool, "dark") },
  { id: "tokyo-night", name: "Tokyo Night", mode: "dark", colors: tokyoNight },
];

export const BUILT_IN_THEMES: readonly ColorTheme[] = SOURCES.map((source) => ({
  id: source.id,
  name: source.name,
  mode: source.mode,
  builtIn: true,
  colors: { ...DEFAULT_COLORS[source.mode], ...source.colors },
  problems: [],
}));

/** 고른 id의 theme. 없거나 모드가 다르면 그 모드의 기본 theme이다. */
export function pickTheme(
  list: readonly ColorTheme[],
  id: string,
  mode: Mode,
): ColorTheme {
  return (
    list.find((theme) => theme.id === id && theme.mode === mode) ??
    BUILT_IN_THEMES.find((theme) => theme.id === DEFAULT_THEMES[mode])!
  );
}

const NAME_MAX = 64;

interface ParsedFile {
  readonly id: string;
  readonly name: string;
  readonly mode?: Mode;
  readonly extends?: string;
  readonly colors: Record<string, string>;
  readonly problems: ThemeProblem[];
}

function parseFile(file: ThemeFile): ParsedFile | BrokenReason {
  let raw: unknown;
  try {
    raw = JSON.parse(file.text);
  } catch {
    return "not_json";
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "bad_shape";
  }
  const record = raw as Record<string, unknown>;
  const { name, mode, colors } = record;
  const parent = record.extends;
  if (
    (name !== undefined &&
      (typeof name !== "string" ||
        name.trim() === "" ||
        name.length > NAME_MAX)) ||
    (mode !== undefined && mode !== "light" && mode !== "dark") ||
    (parent !== undefined && !isThemeId(parent)) ||
    (colors !== undefined &&
      (typeof colors !== "object" || colors === null || Array.isArray(colors)))
  ) {
    return "bad_shape";
  }
  const problems: ThemeProblem[] = [];
  const kept: Record<string, string> = {};
  for (const [path, value] of Object.entries(
    (colors ?? {}) as Record<string, unknown>,
  )) {
    if (!KNOWN.has(path)) problems.push({ kind: "unknown_path", path });
    else if (!isHexColor(value)) problems.push({ kind: "bad_value", path });
    else kept[path] = value;
  }
  return {
    id: file.id,
    name: typeof name === "string" ? name.trim() : file.id,
    ...(mode === undefined ? {} : { mode }),
    ...(parent === undefined ? {} : { extends: parent }),
    colors: kept,
    problems,
  };
}

/**
 * theme file을 읽어 내장 theme 뒤에 붙인다. 쓸 수 없는 file은 broken에 이유와 함께 둔다. 틀린 경로와 값은
 * 그 색만 버리고 문제로 남긴다. 대비는 막지 않고 문제로 남긴다.
 */
export function loadThemes(files: readonly ThemeFile[]): Themes {
  const broken: BrokenTheme[] = [];
  const parsed = new Map<string, ParsedFile>();
  for (const file of [...files].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!isThemeId(file.id)) {
      broken.push({ id: file.id, reason: "bad_id" });
      continue;
    }
    if (BUILT_IN_THEMES.some((theme) => theme.id === file.id)) {
      broken.push({ id: file.id, reason: "id_taken" });
      continue;
    }
    const result = parseFile(file);
    if (typeof result === "string")
      broken.push({ id: file.id, reason: result });
    else parsed.set(file.id, result);
  }

  const resolved = new Map<string, ColorTheme | BrokenReason>();
  const resolve = (
    id: string,
    seen: readonly string[],
  ): ColorTheme | BrokenReason => {
    const done = resolved.get(id);
    if (done !== undefined) return done;
    const file = parsed.get(id)!;
    let result: ColorTheme | BrokenReason;
    if (file.extends === undefined) {
      result =
        file.mode === undefined
          ? "no_mode"
          : themeOf(file, file.mode, DEFAULT_COLORS[file.mode]);
    } else if (seen.includes(file.extends)) {
      result = "extends_cycle";
    } else {
      const builtIn = BUILT_IN_THEMES.find((t) => t.id === file.extends);
      const parent =
        builtIn ??
        (parsed.has(file.extends)
          ? resolve(file.extends, [...seen, id])
          : "unknown_extends");
      result =
        typeof parent === "string"
          ? parent === "extends_cycle"
            ? parent
            : "unknown_extends"
          : themeOf(file, file.mode ?? parent.mode, parent.colors);
    }
    resolved.set(id, result);
    return result;
  };

  const list: ColorTheme[] = [...BUILT_IN_THEMES];
  for (const id of parsed.keys()) {
    const result = resolve(id, [id]);
    if (typeof result === "string") broken.push({ id, reason: result });
    else list.push(result);
  }
  return { list, broken };
}

function themeOf(
  file: ParsedFile,
  mode: Mode,
  inherited: ThemeColors,
): ColorTheme {
  const colors = { ...inherited, ...file.colors };
  return {
    id: file.id,
    name: file.name,
    mode,
    builtIn: false,
    colors,
    problems: [...file.problems, ...contrastProblems(colors)],
  };
}
