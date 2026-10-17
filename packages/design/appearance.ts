// 사람이 고른 appearance를 token을 덮어쓰는 CSS로 만든다. 순수 함수라서 main(모든 문서에 insertCSS),
// gallery, test가 같은 규칙을 쓴다. 값 검사도 여기 있다: Custom 글꼴 이름은 CSS 문자열 안에 들어가므로
// 글자·숫자·공백·`-`·`_`만 받는다. 그 밖의 글자는 따옴표·괄호·세미콜론을 열 수 없는 것만 남기려는 경계다.
import { flatten, type FlatToken } from "./flatten.ts";
import {
  appearancePresets,
  fontStacks,
  type TokenOverride,
} from "./presets.ts";

export const THEMES = ["light", "dark", "system"] as const;
export const FONTS = ["pretendard", "system", "custom"] as const;
export const CODE_FONTS = ["jetbrains-mono", "system", "custom"] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = keyof typeof appearancePresets.accent;
export type Background = keyof typeof appearancePresets.background;
export type Font = (typeof FONTS)[number];
export type CodeFont = (typeof CODE_FONTS)[number];
export type TextSize = keyof typeof appearancePresets.textSize;
export type Density = keyof typeof appearancePresets.density;

export const ACCENTS = Object.keys(appearancePresets.accent) as Accent[];
export const BACKGROUNDS = Object.keys(
  appearancePresets.background,
) as Background[];
export const TEXT_SIZES = Object.keys(appearancePresets.textSize) as TextSize[];
export const DENSITIES = Object.keys(appearancePresets.density) as Density[];

/** 화면 모양 아홉 값. 문서 읽기 폭은 문서가 따로 읽어서 여기 없다. */
export interface Appearance {
  readonly theme: Theme;
  readonly accent: Accent;
  readonly background: Background;
  readonly font: Font;
  /** font가 custom일 때 설치된 글꼴 이름. */
  readonly font_custom: string;
  readonly code_font: CodeFont;
  readonly code_font_custom: string;
  readonly text_size: TextSize;
  readonly density: Density;
}

export const APPEARANCE_DEFAULTS: Appearance = {
  theme: "system",
  accent: "ink",
  background: "warm",
  font: "pretendard",
  font_custom: "",
  code_font: "jetbrains-mono",
  code_font_custom: "",
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
  const theme = oneOf(THEMES, raw.theme);
  const accent = oneOf(ACCENTS, raw.accent);
  const background = oneOf(BACKGROUNDS, raw.background);
  const font = oneOf(FONTS, raw.font);
  const code_font = oneOf(CODE_FONTS, raw.code_font);
  const text_size = oneOf(TEXT_SIZES, raw.text_size);
  const density = oneOf(DENSITIES, raw.density);
  if (
    !theme || !accent || !background || !font || !code_font || !text_size ||
    !density
  ) return undefined;
  const name = (value: unknown) =>
    typeof value === "string" && isFontName(value) ? value : "";
  return {
    theme,
    accent,
    background,
    font,
    font_custom: name(raw.font_custom),
    code_font,
    code_font_custom: name(raw.code_font_custom),
    text_size,
    density,
  };
}

function fontOverride(a: Appearance): TokenOverride {
  const sans = a.font === "system"
    ? fontStacks.sans.system
    : a.font === "custom" && isFontName(a.font_custom)
    ? fontStacks.sans.custom(a.font_custom)
    : undefined;
  const mono = a.code_font === "system"
    ? fontStacks.mono.system
    : a.code_font === "custom" && isFontName(a.code_font_custom)
    ? fontStacks.mono.custom(a.code_font_custom)
    : undefined;
  return {
    font: {
      ...(sans === undefined ? {} : { sans }),
      ...(mono === undefined ? {} : { mono }),
    },
  };
}

/**
 * 기본이 아닌 선택만 token을 덮어쓰는 CSS. 모두 기본이면 빈 문자열이다.
 * tokens.css와 같은 구조(기본 → data-theme=dark → OS가 dark이고 data-theme≠light)이고, 그 규칙보다
 * 선택자 우선순위가 한 칸 높아 문서 안 stylesheet 순서와 상관없이 이긴다.
 */
export function appearanceCss(a: Appearance): string {
  const d = APPEARANCE_DEFAULTS;
  const parts: TokenOverride[] = [
    ...(a.accent === d.accent ? [] : [appearancePresets.accent[a.accent]]),
    ...(a.background === d.background
      ? []
      : [appearancePresets.background[a.background]]),
    appearancePresets.textSize[a.text_size],
    appearancePresets.density[a.density],
    fontOverride(a),
  ];
  const merged = new Map<string, FlatToken>();
  for (const part of parts) {
    for (const token of flatten(part)) merged.set(token.name, token);
  }
  const base = [...merged.values()].map((t) => `  ${t.name}: ${t.light};`);
  const dark = [...merged.values()].filter((t) => t.dark !== undefined).map((
    t,
  ) => `  ${t.name}: ${t.dark};`);
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
