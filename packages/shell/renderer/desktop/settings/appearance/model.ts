// Appearance의 순수 규칙: 줄과 선택지, 그리고 모드를 이 문서에 적는 일.
// 모드는 이 문서의 data-theme에 쓰고, 나머지(theme·accent·글꼴·글자 크기·밀도)는 token을 덮어쓰는 CSS라서
// main이 core 설정을 따라 모든 문서에 넣는다(wiring/appearance.ts). 이 화면은 설정을 쓰기만 한다.
// theme 목록(내장과 `shell.themes` 항목)은 core 설정에서 읽는다.
import {
  ACCENT_FROM_THEME,
  BUILT_IN_THEMES,
  type ColorTheme,
  FONT_WEIGHTS,
  isHex6,
  isThemeId,
  modeColors,
  parseAppearance,
  type ThemeProblem,
  type Themes,
} from "@lophn/ui";
import type { MessageKey } from "@lophn/i18n";

import type {
  AppearanceId,
  AppearanceValues,
  InstalledFont,
} from "./source.ts";

interface AppearanceOption {
  readonly value: string;
  readonly label: MessageKey;
  /** 견본으로 고르는 줄에서 견본 칸의 CSS background. */
  readonly swatch?: string;
  /** 글꼴 줄에서 이 선택지로 고를 수 있는 굵기. 없으면 굵기를 고르지 않는다(UI 글꼴을 따름). */
  readonly weights?: readonly string[];
}

interface AppearanceRow {
  readonly id: AppearanceId;
  /** 설정 선언의 key. */
  readonly settingKey: string;
  readonly name: MessageKey;
  readonly help: MessageKey;
  readonly control: "select" | "theme" | "accent" | "font";
  /** theme 줄이 고르는 모드. */
  readonly mode?: "light" | "dark";
  /** 글꼴 줄에서는 preset이고, 그 뒤에 설치된 글꼴이 붙는다. */
  readonly options: readonly AppearanceOption[];
  /** 글꼴 줄에서 설치된 글꼴 이름을 두는 설정. 그 글꼴을 고르면 이 줄 값은 custom이다. */
  readonly customId?: AppearanceId;
  /** 글꼴 줄의 굵기 설정. */
  readonly weightId?: AppearanceId;
}

// 앱에 실은 Pretendard Variable과 JetBrains Mono가 가진 굵기(base.css의 @font-face).
const BUNDLED_WEIGHTS = ["400", "500", "600"] as const;
// OS stack은 무엇이 그려질지 몰라 Regular·Bold만 둔다.
const STACK_WEIGHTS = ["400", "700"] as const;

// 견본은 light 쪽과 dark 쪽을 반반 보인다. 어느 모드이든 같은 그림이다.
function half(light: string, dark: string): string {
  return `linear-gradient(135deg, ${light} 50%, ${dark} 50%)`;
}

/** 빠르게 고르는 accent 색. 옛 accent preset의 색이고, 그 밖의 색은 색 칸에서 고른다. */
const ACCENT_PRESETS = [
  { value: "#1d5bbf", label: "settings.label.accent-blue" },
  { value: "#1b7a3c", label: "settings.label.accent-green" },
  { value: "#6b3fc4", label: "settings.label.accent-purple" },
  { value: "#b34a0c", label: "settings.label.accent-orange" },
] as const;

export const APPEARANCE_ROWS: readonly AppearanceRow[] = [
  {
    id: "mode",
    settingKey: "shell.mode",
    name: "settings.label.mode",
    help: "settings.appearance.mode-help",
    control: "select",
    options: [
      { value: "light", label: "settings.label.mode-light" },
      { value: "dark", label: "settings.label.mode-dark" },
      { value: "system", label: "settings.label.mode-system" },
    ],
  },
  {
    id: "light_theme",
    settingKey: "shell.light_theme",
    name: "settings.label.light-theme",
    help: "settings.appearance.light-theme-help",
    control: "theme",
    mode: "light",
    options: [],
  },
  {
    id: "dark_theme",
    settingKey: "shell.dark_theme",
    name: "settings.label.dark-theme",
    help: "settings.appearance.dark-theme-help",
    control: "theme",
    mode: "dark",
    options: [],
  },
  {
    id: "accent",
    settingKey: "shell.accent",
    name: "settings.label.accent",
    help: "settings.appearance.accent-help",
    control: "accent",
    options: [
      { value: ACCENT_FROM_THEME, label: "settings.label.accent-theme" },
      ...ACCENT_PRESETS.map((preset) => ({
        ...preset,
        swatch: preset.value,
      })),
    ],
  },
  {
    id: "font",
    settingKey: "shell.font",
    name: "settings.label.font",
    help: "settings.appearance.font-help",
    control: "font",
    customId: "font_custom",
    weightId: "font_weight",
    options: [
      {
        value: "pretendard",
        label: "settings.label.font-pretendard",
        weights: BUNDLED_WEIGHTS,
      },
      {
        value: "system",
        label: "settings.label.font-system",
        weights: STACK_WEIGHTS,
      },
    ],
  },
  {
    id: "code_font",
    settingKey: "shell.code_font",
    name: "settings.label.code-font",
    help: "settings.appearance.code-font-help",
    control: "font",
    customId: "code_font_custom",
    weightId: "code_font_weight",
    options: [
      {
        value: "jetbrains-mono",
        label: "settings.label.code-font-jetbrains",
        weights: BUNDLED_WEIGHTS,
      },
      {
        value: "system",
        label: "settings.label.code-font-system",
        weights: STACK_WEIGHTS,
      },
    ],
  },
  {
    id: "reading_font",
    settingKey: "shell.reading_font",
    name: "settings.label.reading-font",
    help: "settings.appearance.reading-font-help",
    control: "font",
    customId: "reading_font_custom",
    weightId: "reading_font_weight",
    options: [
      { value: "ui", label: "settings.label.reading-font-ui" },
      {
        value: "serif",
        label: "settings.label.reading-font-serif",
        weights: STACK_WEIGHTS,
      },
    ],
  },
  {
    id: "text_size",
    settingKey: "shell.text_size",
    name: "settings.label.text-size",
    help: "settings.appearance.text-size-help",
    control: "select",
    options: [
      { value: "small", label: "settings.label.size-small" },
      { value: "default", label: "settings.label.size-default" },
      { value: "large", label: "settings.label.size-large" },
    ],
  },
  {
    id: "reading_width",
    settingKey: "shell.reading_width",
    name: "settings.label.reading-width",
    help: "settings.appearance.reading-width-help",
    control: "select",
    options: [
      { value: "narrow", label: "settings.label.width-narrow" },
      { value: "default", label: "settings.label.width-standard" },
      { value: "wide", label: "settings.label.width-wide" },
    ],
  },
  {
    id: "density",
    settingKey: "shell.density",
    name: "settings.label.density",
    help: "settings.appearance.density-help",
    control: "select",
    options: [
      { value: "comfortable", label: "settings.label.density-comfortable" },
      { value: "compact", label: "settings.label.density-compact" },
    ],
  },
];

/** 설치된 글꼴 이름을 두는 설정. 이름은 선택지가 없는 글 값이다. */
export const CUSTOM_IDS = [
  "font_custom",
  "code_font_custom",
  "reading_font_custom",
] as const;

/** 글꼴 굵기 설정. 값은 FONT_WEIGHTS 안이다. */
export const WEIGHT_IDS = [
  "font_weight",
  "code_font_weight",
  "reading_font_weight",
] as const;

export function settingKeyOf(id: AppearanceId): string {
  return `shell.${id}`;
}

/** 선언이 아직 없을 때 쓰는 값. 선언의 기본값과 같다. */
export const APPEARANCE_DEFAULTS: AppearanceValues = {
  mode: "system",
  light_theme: "warm-light",
  dark_theme: "warm-dark",
  accent: ACCENT_FROM_THEME,
  font: "pretendard",
  font_custom: "",
  font_weight: "400",
  code_font: "jetbrains-mono",
  code_font_custom: "",
  code_font_weight: "400",
  reading_font: "ui",
  reading_font_custom: "",
  reading_font_weight: "400",
  text_size: "default",
  reading_width: "default",
  density: "comfortable",
};

/**
 * 저장된 값이 선택지 안에 있을 때만 쓴다(글꼴 줄은 custom도, theme 줄은 id 모양이면, accent는 hex도).
 * 아니면 기본값이다.
 */
export function valueOf(row: AppearanceRow, stored: unknown): string {
  if (row.control === "theme") {
    return isThemeId(stored) ? stored : APPEARANCE_DEFAULTS[row.id];
  }
  if (row.control === "accent" && isHex6(stored)) return stored;
  const known =
    row.options.some((option) => option.value === stored) ||
    (row.customId !== undefined && stored === "custom");
  return known ? (stored as string) : APPEARANCE_DEFAULTS[row.id];
}

/** 저장된 글 값. 글이 아니면 비어 있다. */
export function customValueOf(stored: unknown): string {
  return typeof stored === "string" ? stored : "";
}

/** 저장된 굵기. FONT_WEIGHTS 밖이면 Regular다. */
export function weightValueOf(stored: unknown): string {
  return (FONT_WEIGHTS as readonly unknown[]).includes(stored)
    ? (stored as string)
    : "400";
}

// 설치된 글꼴 선택지의 값. preset 값과 겹치지 않게 앞에 붙인다.
const INSTALLED = "installed:";

/** 글꼴 줄에서 지금 고른 것. 설치된 글꼴이면 `installed:<이름>`이다. */
export function fontChoiceOf(
  row: AppearanceRow,
  values: AppearanceValues,
): string {
  const custom = row.customId === undefined ? "" : values[row.customId];
  return values[row.id] === "custom" && custom !== ""
    ? `${INSTALLED}${custom}`
    : values[row.id];
}

/** 글꼴 줄의 선택지. preset, 목록에 없는 저장 이름(설치되지 않음), 설치된 글꼴 순이다. */
export function fontChoices(
  row: AppearanceRow,
  values: AppearanceValues,
  fonts: readonly InstalledFont[] | null,
): readonly {
  readonly value: string;
  readonly label: string | MessageKey;
  readonly preset: boolean;
  readonly missing: boolean;
}[] {
  const custom = row.customId === undefined ? "" : values[row.customId];
  const listed = fonts?.some((font) => font.family === custom) ?? false;
  return [
    ...row.options.map((option) => ({
      value: option.value,
      label: option.label,
      preset: true,
      missing: false,
    })),
    ...(custom !== "" && !listed
      ? [
          {
            value: `${INSTALLED}${custom}`,
            label: custom,
            preset: false,
            // 목록을 읽기 전에는 설치됐는지 모른다.
            missing: fonts !== null,
          },
        ]
      : []),
    ...(fonts ?? []).map((font) => ({
      value: `${INSTALLED}${font.family}`,
      label: font.family,
      preset: false,
      missing: false,
    })),
  ];
}

/** 저장된 설치 글꼴 이름이 이 컴퓨터에 없으면 그 이름. 목록을 읽기 전이거나 있으면 undefined다. */
export function missingFontOf(
  row: AppearanceRow,
  values: AppearanceValues,
  fonts: readonly InstalledFont[] | null,
): string | undefined {
  return fontChoices(row, values, fonts).find(
    (option) => option.missing && option.value === fontChoiceOf(row, values),
  )?.label;
}

/** 고른 것에서 고를 수 있는 굵기. undefined면 굵기를 고르지 않는다. 목록에 없는 글꼴은 Regular·Bold다. */
export function weightsOf(
  row: AppearanceRow,
  choice: string,
  fonts: readonly InstalledFont[] | null,
): readonly string[] | undefined {
  if (choice.startsWith(INSTALLED)) {
    const family = choice.slice(INSTALLED.length);
    return (
      fonts?.find((font) => font.family === family)?.weights ?? STACK_WEIGHTS
    );
  }
  return row.options.find((option) => option.value === choice)?.weights;
}

/**
 * 글꼴 줄에서 하나를 골랐을 때 바꿀 값. 설치된 글꼴이면 이름을 먼저 두고 줄 값을 custom으로 한다.
 * 지금 굵기가 새 글꼴에 없으면 가장 가까운 굵기로 옮긴다.
 */
export function chooseFont(
  row: AppearanceRow,
  values: AppearanceValues,
  choice: string,
  fonts: readonly InstalledFont[] | null,
): readonly (readonly [AppearanceId, string])[] {
  const changes: [AppearanceId, string][] = choice.startsWith(INSTALLED)
    ? [
        [row.customId!, choice.slice(INSTALLED.length)],
        [row.id, "custom"],
      ]
    : [[row.id, choice]];
  const weights = weightsOf(row, choice, fonts);
  if (row.weightId !== undefined && weights !== undefined) {
    const current = Number(values[row.weightId]);
    const nearest = weights.reduce((best, weight) =>
      Math.abs(Number(weight) - current) < Math.abs(Number(best) - current)
        ? weight
        : best,
    );
    if (nearest !== values[row.weightId]) {
      changes.push([row.weightId, nearest]);
    }
  }
  return changes;
}

/** theme 줄의 선택지: 그 모드의 theme과, 목록에 없는 저장 id(없는 file). */
export function themeChoices(
  row: AppearanceRow,
  values: AppearanceValues,
  themes: Themes | null,
): readonly {
  readonly value: string;
  readonly name: string;
  readonly file: boolean;
  readonly missing: boolean;
}[] {
  const list = (themes?.list ?? BUILT_IN_THEMES).filter(
    (theme) => theme.mode === row.mode,
  );
  const value = values[row.id];
  return [
    ...list.map((theme) => ({
      value: theme.id,
      name: theme.name,
      file: !theme.builtIn,
      missing: false,
    })),
    ...(list.some((theme) => theme.id === value)
      ? []
      : [{ value, name: value, file: true, missing: themes !== null }]),
  ];
}

/** theme 줄에서 고른 theme. 목록에 없으면 undefined다. */
export function chosenTheme(
  row: AppearanceRow,
  values: AppearanceValues,
  themes: Themes | null,
): ColorTheme | undefined {
  return (themes?.list ?? BUILT_IN_THEMES).find(
    (theme) => theme.id === values[row.id] && theme.mode === row.mode,
  );
}

/** 고른 theme file의 문제. */
export function themeProblemsOf(
  row: AppearanceRow,
  values: AppearanceValues,
  themes: Themes | null,
): readonly ThemeProblem[] {
  return chosenTheme(row, values, themes)?.problems ?? [];
}

/** accent 견본. "theme을 따름"은 고른 두 theme의 accent를 반반 보인다. */
export function accentSwatch(
  value: string,
  values: AppearanceValues,
  themes: Themes | null,
): string {
  if (value !== ACCENT_FROM_THEME) return value;
  const appearance = parseAppearance({ ...values, accent: ACCENT_FROM_THEME });
  if (appearance === undefined) return "";
  const list = themes?.list ?? BUILT_IN_THEMES;
  return half(
    modeColors(appearance, "light", list)["color.ink.background"]!,
    modeColors(appearance, "dark", list)["color.ink.background"]!,
  );
}

/** Light·Dark는 이 문서의 data-theme에 쓰고 System은 지워 OS 설정을 따른다. 나머지는 main이 넣는 CSS다. */
export function applyAppearance(
  values: AppearanceValues,
  root: HTMLElement = document.documentElement,
): void {
  const appearance = parseAppearance(values);
  if (appearance === undefined) return;
  if (appearance.mode === "system") delete root.dataset.theme;
  else root.dataset.theme = appearance.mode;
}
