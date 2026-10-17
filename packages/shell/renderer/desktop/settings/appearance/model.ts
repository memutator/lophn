// Appearance의 순수 규칙: 네 줄과 선택지, 그리고 Theme을 화면에 바로 적용하는 일.
// Text size와 Density를 적용할 token이 design에 아직 없어 두 줄은 값만 저장한다.
import type { MessageKey } from "@lophn/wording";

import type { Theme, ThemeApi } from "../../../../../ipc/theme.ts";
import type { AppearanceId, AppearanceValues } from "./source.ts";

interface AppearanceOption {
  readonly value: string;
  readonly label: MessageKey;
}

interface AppearanceRow {
  readonly id: AppearanceId;
  /** 설정 선언의 key. */
  readonly settingKey: string;
  readonly name: MessageKey;
  readonly help: MessageKey;
  readonly options: readonly AppearanceOption[];
}

export const APPEARANCE_ROWS: readonly AppearanceRow[] = [
  {
    id: "theme",
    settingKey: "shell.theme",
    name: "settings.label.theme",
    help: "settings.appearance.theme-help",
    options: [
      { value: "light", label: "settings.label.theme-light" },
      { value: "dark", label: "settings.label.theme-dark" },
      { value: "system", label: "settings.label.theme-system" },
    ],
  },
  {
    id: "text_size",
    settingKey: "shell.text_size",
    name: "settings.label.text-size",
    help: "settings.appearance.text-size-help",
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
    options: [
      { value: "comfortable", label: "settings.label.density-comfortable" },
      { value: "compact", label: "settings.label.density-compact" },
    ],
  },
];

/** 선언이 아직 없을 때 쓰는 값. 선언의 기본값과 같다. */
export const APPEARANCE_DEFAULTS: AppearanceValues = {
  theme: "system",
  text_size: "default",
  reading_width: "default",
  density: "comfortable",
};

/** 저장된 값이 선택지 안에 있을 때만 쓴다. 아니면 기본값이다. */
export function valueOf(row: AppearanceRow, stored: unknown): string {
  return row.options.some((option) => option.value === stored)
    ? stored as string
    : APPEARANCE_DEFAULTS[row.id];
}

/**
 * Light·Dark는 data-theme에 쓰고 System은 지워 OS 설정을 따른다. overlay 같은 다른 문서는
 * data-theme이 없어 OS 설정만 보므로, 고른 theme을 main에도 알려 그쪽 prefers-color-scheme을 맞춘다.
 */
export function applyTheme(
  value: string,
  root: HTMLElement = document.documentElement,
): void {
  const theme: Theme = value === "light" || value === "dark" ? value : "system";
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  (globalThis as { lophnTheme?: ThemeApi }).lophnTheme?.set(theme);
}
