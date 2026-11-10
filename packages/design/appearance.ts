// 사람이 고른 appearance를 token을 덮어쓰는 CSS로 만든다. 순수 함수라서 main(모든 문서에 insertCSS),
// gallery, test가 같은 규칙을 쓴다. 값 검사도 여기 있다: Custom 글꼴 이름은 CSS 문자열 안에 들어가므로
// 글자·숫자·공백·`-`·`_`만 받는다. 그 밖의 글자는 따옴표·괄호·세미콜론을 열 수 없는 것만 남기려는 경계다.
// 색 값은 hex 형식만 CSS에 쓴다(theme file에서 온 값도 같다).
import { isHex6, isHexColor } from "./color.ts";
import { flatten, tokenVar } from "./flatten.ts";
import {
  appearancePresets,
  fontStacks,
  type TokenOverride,
} from "./presets.ts";
import {
  accentColors,
  BUILT_IN_THEMES,
  type ColorTheme,
  DEFAULT_COLORS,
  DEFAULT_THEMES,
  isThemeId,
  type Mode,
  pickTheme,
  THEME_PATHS,
} from "./themes.ts";

export const MODES = ["light", "dark", "system"] as const;
/** accent 값이 이것이면 theme에 적힌 accent를 쓴다. 아니면 `#rrggbb`다. */
export const ACCENT_FROM_THEME = "theme";
export const FONTS = ["pretendard", "system", "custom"] as const;
export const CODE_FONTS = ["jetbrains-mono", "system", "custom"] as const;
/** ui는 UI 글꼴(`font`)을 따른다. */
export const READING_FONTS = ["ui", "serif", "custom"] as const;
/** 글꼴마다 고르는 본문 굵기(CSS font-weight). 강조·제목 굵기는 바뀌지 않는다. */
export const FONT_WEIGHTS = [
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
] as const;

export type AppearanceMode = (typeof MODES)[number];
export type Font = (typeof FONTS)[number];
export type CodeFont = (typeof CODE_FONTS)[number];
export type ReadingFont = (typeof READING_FONTS)[number];
export type FontWeight = (typeof FONT_WEIGHTS)[number];
export type TextSize = keyof typeof appearancePresets.textSize;
export type Density = keyof typeof appearancePresets.density;

export const TEXT_SIZES = Object.keys(appearancePresets.textSize) as TextSize[];
export const DENSITIES = Object.keys(appearancePresets.density) as Density[];

/** 화면 모양 열다섯 값. 문서 읽기 폭은 문서가 따로 읽어서 여기 없다. */
export interface Appearance {
  readonly mode: AppearanceMode;
  /** light 모드에서 쓰는 theme id. 목록에 없으면 기본 theme이다. */
  readonly light_theme: string;
  readonly dark_theme: string;
  /** `theme`이거나 `#rrggbb`. */
  readonly accent: string;
  readonly font: Font;
  /** font가 custom일 때 설치된 글꼴 이름. */
  readonly font_custom: string;
  readonly font_weight: FontWeight;
  readonly code_font: CodeFont;
  readonly code_font_custom: string;
  readonly code_font_weight: FontWeight;
  /** 문서와 대화 본문의 글꼴. */
  readonly reading_font: ReadingFont;
  readonly reading_font_custom: string;
  /** reading_font가 ui면 쓰지 않고 font_weight를 따른다. */
  readonly reading_font_weight: FontWeight;
  readonly text_size: TextSize;
  readonly density: Density;
}

export const APPEARANCE_DEFAULTS: Appearance = {
  mode: "system",
  light_theme: DEFAULT_THEMES.light,
  dark_theme: DEFAULT_THEMES.dark,
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
  density: "comfortable",
};

const FONT_NAME = /^[\p{L}\p{N} _-]{1,64}$/u;

/** Custom 글꼴 이름으로 쓸 수 있는가. 비어 있으면 아니다. */
export function isFontName(name: string): boolean {
  return FONT_NAME.test(name);
}

function oneOf<T extends string>(
  list: readonly T[],
  value: unknown,
): T | undefined {
  return list.find((item) => item === value);
}

/**
 * 밖에서 온 값을 검사한다. 고르는 값이 목록 밖이면 전체를 거절한다(undefined). Custom 이름이 글꼴 이름
 * 규칙을 어기면 그 이름만 버려 기본 글꼴로 둔다.
 */
export function parseAppearance(input: unknown): Appearance | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const raw = input as Record<string, unknown>;
  const mode = oneOf(MODES, raw.mode);
  const light_theme = isThemeId(raw.light_theme) ? raw.light_theme : undefined;
  const dark_theme = isThemeId(raw.dark_theme) ? raw.dark_theme : undefined;
  const accent =
    raw.accent === ACCENT_FROM_THEME || isHex6(raw.accent)
      ? raw.accent
      : undefined;
  const font = oneOf(FONTS, raw.font);
  const code_font = oneOf(CODE_FONTS, raw.code_font);
  const reading_font = oneOf(READING_FONTS, raw.reading_font);
  const font_weight = oneOf(FONT_WEIGHTS, raw.font_weight);
  const code_font_weight = oneOf(FONT_WEIGHTS, raw.code_font_weight);
  const reading_font_weight = oneOf(FONT_WEIGHTS, raw.reading_font_weight);
  const text_size = oneOf(TEXT_SIZES, raw.text_size);
  const density = oneOf(DENSITIES, raw.density);
  if (
    !mode ||
    !light_theme ||
    !dark_theme ||
    !accent ||
    !font ||
    !code_font ||
    !reading_font ||
    !font_weight ||
    !code_font_weight ||
    !reading_font_weight ||
    !text_size ||
    !density
  )
    return undefined;
  const name = (value: unknown) =>
    typeof value === "string" && isFontName(value) ? value : "";
  return {
    mode,
    light_theme,
    dark_theme,
    accent,
    font,
    font_custom: name(raw.font_custom),
    font_weight,
    code_font,
    code_font_custom: name(raw.code_font_custom),
    code_font_weight,
    reading_font,
    reading_font_custom: name(raw.reading_font_custom),
    reading_font_weight,
    text_size,
    density,
  };
}

function fontOverride(a: Appearance): TokenOverride {
  const sans =
    a.font === "system"
      ? fontStacks.sans.system
      : a.font === "custom" && isFontName(a.font_custom)
        ? fontStacks.sans.custom(a.font_custom)
        : undefined;
  const mono =
    a.code_font === "system"
      ? fontStacks.mono.system
      : a.code_font === "custom" && isFontName(a.code_font_custom)
        ? fontStacks.mono.custom(a.code_font_custom)
        : undefined;
  // ui나 이름이 틀린 custom은 UI 글꼴을 따른다.
  const reading =
    a.reading_font === "serif"
      ? fontStacks.reading.serif
      : a.reading_font === "custom" && isFontName(a.reading_font_custom)
        ? fontStacks.reading.custom(a.reading_font_custom)
        : sans;
  // ui인 읽기 글꼴은 굵기도 UI 글꼴을 따른다.
  const readingWeight =
    a.reading_font === "ui" ? a.font_weight : a.reading_font_weight;
  const d = APPEARANCE_DEFAULTS;
  const weight = {
    ...(a.font_weight === d.font_weight ? {} : { regular: a.font_weight }),
    ...(a.code_font_weight === d.code_font_weight
      ? {}
      : { mono: a.code_font_weight }),
    ...(readingWeight === d.reading_font_weight
      ? {}
      : { reading: readingWeight }),
  };
  return {
    font: {
      ...(sans === undefined ? {} : { sans }),
      ...(mono === undefined ? {} : { mono }),
      ...(reading === undefined ? {} : { reading }),
      ...(Object.keys(weight).length === 0 ? {} : { weight }),
    },
  };
}

/** 한 모드의 색: 고른 theme에 accent를 덮은 것. */
export function modeColors(
  a: Appearance,
  mode: Mode,
  themes: readonly ColorTheme[] = BUILT_IN_THEMES,
): Record<string, string> {
  const theme = pickTheme(
    themes,
    mode === "light" ? a.light_theme : a.dark_theme,
    mode,
  );
  return {
    ...theme.colors,
    ...(a.accent === ACCENT_FROM_THEME
      ? {}
      : accentColors(a.accent, theme.colors, mode)),
  };
}

// 기본과 다른 hex 색만 남긴다. hex가 아닌 값은 어디서 왔든 CSS에 쓰지 않는다.
function colorLines(colors: Record<string, string>, mode: Mode): string[] {
  return THEME_PATHS.filter(
    (path) =>
      colors[path] !== DEFAULT_COLORS[mode][path] && isHexColor(colors[path]),
  ).map((path) => `  ${tokenVar(path.split("."))}: ${colors[path]};`);
}

/**
 * 기본이 아닌 선택만 token을 덮어쓰는 CSS. 모두 기본이면 빈 문자열이다. light 블록은 light theme 색과
 * 글꼴·크기·밀도, dark 블록은 dark theme 색이다. `themes`는 고를 수 있는 theme(내장과 theme file)이다.
 * tokens.css와 같은 구조(기본 → data-theme=dark → OS가 dark이고 data-theme≠light)이고, 그 규칙보다
 * 선택자 우선순위가 한 칸 높아 문서 안 stylesheet 순서와 상관없이 이긴다.
 */
export function appearanceCss(
  a: Appearance,
  themes: readonly ColorTheme[] = BUILT_IN_THEMES,
): string {
  const parts: TokenOverride[] = [
    appearancePresets.textSize[a.text_size],
    appearancePresets.density[a.density],
    fontOverride(a),
  ];
  const merged = new Map<string, string>();
  for (const part of parts) {
    for (const token of flatten(part)) merged.set(token.name, token.light);
  }
  const base = [
    ...colorLines(modeColors(a, "light", themes), "light"),
    ...[...merged].map(([name, value]) => `  ${name}: ${value};`),
  ];
  const dark = colorLines(modeColors(a, "dark", themes), "dark");
  return [
    ...(base.length ? ["html:root {", ...base, "}"] : []),
    ...(dark.length
      ? [
          'html[data-theme="dark"] {',
          ...dark,
          "}",
          "@media (prefers-color-scheme: dark) {",
          '  html:root:not([data-theme="light"]) {',
          ...dark.map((line) => `  ${line}`),
          "  }",
          "}",
        ]
      : []),
  ].join("\n");
}
