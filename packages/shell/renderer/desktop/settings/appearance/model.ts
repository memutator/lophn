// Appearance의 순수 규칙: 줄과 선택지, 그리고 고른 값을 화면에 바로 적용하는 일.
// theme은 이 문서의 data-theme에 쓰고, 나머지(accent·배경·글꼴·글자 크기·밀도)는 token을 덮어쓰는 CSS라서
// main이 모든 문서에 넣는다(wiring/appearance.ts). 그래서 여기서는 값 전체를 main에 보내기만 한다.
import { appearancePresets, parseAppearance } from "@lophn/ui";
import type { MessageKey } from "@lophn/wording";

import type { AppearanceApi } from "../../../../ipc/appearance.ts";
import type { AppearanceId, AppearanceValues } from "./source.ts";

interface AppearanceOption {
  readonly value: string;
  readonly label: MessageKey;
  /** 견본으로 고르는 줄에서 견본 칸의 CSS background. */
  readonly swatch?: string;
}

interface AppearanceRow {
  readonly id: AppearanceId;
  /** 설정 선언의 key. */
  readonly settingKey: string;
  readonly name: MessageKey;
  readonly help: MessageKey;
  readonly control: "select" | "swatch";
  readonly options: readonly AppearanceOption[];
  /** 선택지에 Custom이 있는 줄이 설치된 글꼴 이름을 적는 줄. */
  readonly customId?: AppearanceId;
}

// 견본은 light 쪽과 dark 쪽을 반반 보인다. 어느 theme이든 같은 그림이다.
function half(light: string, dark: string): string {
  return `linear-gradient(135deg, ${light} 50%, ${dark} 50%)`;
}

function accentSwatch(name: keyof typeof appearancePresets.accent): string {
  const { background } = appearancePresets.accent[name].color.ink;
  return half(background.light, background.dark);
}

function backgroundSwatch(
  name: keyof typeof appearancePresets.background,
): string {
  const { surface, border } = appearancePresets.background[name].color;
  // 틴트가 잘 보이게 light의 surface·border 띠와 dark의 surface 띠를 이어 붙인다.
  return `linear-gradient(135deg, ${surface.muted.light} 33%, ${border.strong.light} 33% 66%, ${surface.muted.dark} 66%)`;
}

export const APPEARANCE_ROWS: readonly AppearanceRow[] = [
  {
    id: "theme",
    settingKey: "shell.theme",
    name: "settings.label.theme",
    help: "settings.appearance.theme-help",
    control: "select",
    options: [
      { value: "light", label: "settings.label.theme-light" },
      { value: "dark", label: "settings.label.theme-dark" },
      { value: "system", label: "settings.label.theme-system" },
    ],
  },
  {
    id: "accent",
    settingKey: "shell.accent",
    name: "settings.label.accent",
    help: "settings.appearance.accent-help",
    control: "swatch",
    options: [
      {
        value: "ink",
        label: "settings.label.accent-ink",
        swatch: accentSwatch("ink"),
      },
      {
        value: "blue",
        label: "settings.label.accent-blue",
        swatch: accentSwatch("blue"),
      },
      {
        value: "green",
        label: "settings.label.accent-green",
        swatch: accentSwatch("green"),
      },
      {
        value: "purple",
        label: "settings.label.accent-purple",
        swatch: accentSwatch("purple"),
      },
      {
        value: "orange",
        label: "settings.label.accent-orange",
        swatch: accentSwatch("orange"),
      },
    ],
  },
  {
    id: "background",
    settingKey: "shell.background",
    name: "settings.label.background",
    help: "settings.appearance.background-help",
    control: "swatch",
    options: [
      {
        value: "warm",
        label: "settings.label.background-warm",
        swatch: backgroundSwatch("warm"),
      },
      {
        value: "neutral",
        label: "settings.label.background-neutral",
        swatch: backgroundSwatch("neutral"),
      },
      {
        value: "cool",
        label: "settings.label.background-cool",
        swatch: backgroundSwatch("cool"),
      },
    ],
  },
  {
    id: "font",
    settingKey: "shell.font",
    name: "settings.label.font",
    help: "settings.appearance.font-help",
    control: "select",
    customId: "font_custom",
    options: [
      { value: "pretendard", label: "settings.label.font-pretendard" },
      { value: "system", label: "settings.label.font-system" },
      { value: "custom", label: "settings.label.font-custom" },
    ],
  },
  {
    id: "code_font",
    settingKey: "shell.code_font",
    name: "settings.label.code-font",
    help: "settings.appearance.code-font-help",
    control: "select",
    customId: "code_font_custom",
    options: [
      { value: "jetbrains-mono", label: "settings.label.code-font-jetbrains" },
      { value: "system", label: "settings.label.code-font-system" },
      { value: "custom", label: "settings.label.font-custom" },
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

/** Custom 이름을 적는 설정의 key. 이름은 선택지가 없는 글 값이다. */
export const CUSTOM_IDS = ["font_custom", "code_font_custom"] as const;

export function settingKeyOf(id: AppearanceId): string {
  return `shell.${id}`;
}

/** 선언이 아직 없을 때 쓰는 값. 선언의 기본값과 같다. */
export const APPEARANCE_DEFAULTS: AppearanceValues = {
  theme: "system",
  accent: "ink",
  background: "warm",
  font: "pretendard",
  font_custom: "",
  code_font: "jetbrains-mono",
  code_font_custom: "",
  text_size: "default",
  reading_width: "default",
  density: "comfortable",
};

/** 저장된 값이 선택지 안에 있을 때만 쓴다. 아니면 기본값이다. */
export function valueOf(row: AppearanceRow, stored: unknown): string {
  return row.options.some((option) => option.value === stored)
    ? (stored as string)
    : APPEARANCE_DEFAULTS[row.id];
}

/** 저장된 글 값. 글이 아니면 비어 있다. */
export function customValueOf(stored: unknown): string {
  return typeof stored === "string" ? stored : "";
}

/**
 * Light·Dark는 data-theme에 쓰고 System은 지워 OS 설정을 따른다. 나머지 값과 theme은 main에도 알려
 * overlay·보호 입력 창·앱 view까지 같은 모양이 되게 한다(main이 값을 다시 검사한다).
 */
export function applyAppearance(
  values: AppearanceValues,
  root: HTMLElement = document.documentElement,
): void {
  const appearance = parseAppearance(values);
  if (appearance === undefined) return;
  if (appearance.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = appearance.theme;
  (globalThis as { lophnAppearance?: AppearanceApi }).lophnAppearance?.set(
    appearance,
  );
}
