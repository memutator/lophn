// 첫 창이 열리기 전에 `<data root>/settings.json`과 `<data root>/themes/*.json`에서
// 마지막으로 저장된 appearance를 한 번 읽는다. core가 아직 준비되지 않은 동안("lophn is getting ready.")에도
// 창 바탕색(`backgroundColor`), `nativeTheme.themeSource`, 덮어쓰는 CSS가 사람의 마지막 설정을 따르게 한다.
// core가 붙어 `settings/list`를 받으면 그 사본이 정본으로 이어받는다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  type Appearance,
  APPEARANCE_DEFAULTS,
  appearanceCss,
  modeColors,
  parseAppearance,
} from "../../../../design/appearance.ts";
import {
  type ColorTheme,
  isThemeId,
  loadThemes,
} from "../../../../design/themes.ts";

// core의 theme file 상한(`settings.md`, 256 KiB)과 같다.
const MAX_THEME_FILE_BYTES = 256 * 1024;

export interface InitialAppearance {
  readonly appearance: Appearance;
  readonly themes: readonly ColorTheme[];
  readonly css: string;
}

/**
 * `settings.json` 객체에서 `shell.*` appearance 값을 읽어 검사한다.
 * 빠졌거나 틀린 칸은 개별적으로 기본값으로 돌려, 한 칸이 낡아도 나머지 설정(예: `shell.mode`)은 유지한다.
 */
export function parseStoredAppearance(raw: unknown): Appearance {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return APPEARANCE_DEFAULTS;
  }
  const record = raw as Record<string, unknown>;
  const candidate: Record<string, unknown> = {};
  for (const field of Object.keys(APPEARANCE_DEFAULTS) as Array<
    keyof Appearance
  >) {
    const stored = record[`shell.${field}`];
    candidate[field] =
      stored === undefined ? APPEARANCE_DEFAULTS[field] : stored;
  }
  const whole = parseAppearance(candidate);
  if (whole !== undefined) return whole;
  // 한 칸이라도 목록 밖이면 유효한 칸만 살리고 나머지는 기본값으로 둔다.
  const merged: Record<string, unknown> = { ...APPEARANCE_DEFAULTS };
  for (const field of Object.keys(APPEARANCE_DEFAULTS) as Array<
    keyof Appearance
  >) {
    const probe = parseAppearance({
      ...APPEARANCE_DEFAULTS,
      [field]: candidate[field],
    });
    if (probe !== undefined) merged[field] = probe[field];
  }
  return parseAppearance(merged) ?? APPEARANCE_DEFAULTS;
}

function readStoredSettings(dataRoot: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dataRoot, "settings.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function readStoredThemeFiles(
  dataRoot: string,
): readonly { readonly id: string; readonly text: string }[] {
  const dir = join(dataRoot, "themes");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: { id: string; text: string }[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!isThemeId(id)) continue;
    const full = join(dir, name);
    try {
      const info = statSync(full);
      if (!info.isFile() || info.size > MAX_THEME_FILE_BYTES) continue;
      files.push({ id, text: readFileSync(full, "utf8") });
    } catch {
      // 읽지 못한 theme file은 건너뛴다.
    }
  }
  return files;
}

/** data root에서 시작 appearance와 CSS를 읽는다. 파일이 없거나 깨져도 기본값으로 돌아간다. */
export function readInitialAppearance(dataRoot: string): InitialAppearance {
  const appearance = parseStoredAppearance(readStoredSettings(dataRoot));
  const themes = loadThemes(readStoredThemeFiles(dataRoot)).list;
  return {
    appearance,
    themes,
    css: appearanceCss(appearance, themes),
  };
}

/** 지금 모드·theme의 shell 창 바탕색(`color.surface.shell`). BrowserWindow 초기 페인트 깜빡임을 막는다. */
export function shellBackgroundColor(
  appearance: Appearance,
  themes: readonly ColorTheme[],
  osDark: boolean,
): string | undefined {
  const effective =
    appearance.mode === "system"
      ? osDark
        ? "dark"
        : "light"
      : appearance.mode;
  return modeColors(appearance, effective, themes)["color.surface.shell"];
}
