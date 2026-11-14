// AppearanceSource를 선언 설정(`shell.*`)의 쓰기로 만든다. 화면은 `settings/list`를 useCoreRead로 읽고 이 file의
// 함수로 푼다. 설치된 글꼴은 받은 queryLocalFonts로 읽고, theme 목록은 core 설정의 항목(`shell.themes`)을
// main과 같은 규칙(loadThemes)으로 푼 것이다.
import { loadThemes, type Themes } from "@lophn/ui";

import {
  type AppearanceApi,
  THEMES_SETTING_KEY,
} from "../../../../ipc/appearance.ts";
import type { CoreSource } from "../../connection/connection.ts";
import {
  chooseSetting,
  readEffective,
  type SettingFolderView,
} from "../declared.ts";
import { installedFonts, type QueryLocalFonts } from "./local-fonts.ts";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_ROWS,
  CUSTOM_IDS,
  customValueOf,
  settingKeyOf,
  valueOf,
  WEIGHT_IDS,
  weightValueOf,
} from "./model.ts";
import type { AppearanceSource, AppearanceValues } from "./source.ts";

/** Appearance가 읽는 설정 key. theme file 묶음도 같이 읽는다. */
export const APPEARANCE_KEYS: readonly string[] = [
  ...APPEARANCE_ROWS.map((row) => row.settingKey),
  ...CUSTOM_IDS.map(settingKeyOf),
  ...WEIGHT_IDS.map(settingKeyOf),
  THEMES_SETTING_KEY,
];

/** key마다의 지금 값에서 화면 값. 모르는 값은 기본값이다. */
export function appearanceValuesOf(
  read: ReadonlyMap<string, unknown>,
): AppearanceValues {
  const values: Record<string, string> = { ...APPEARANCE_DEFAULTS };
  for (const row of APPEARANCE_ROWS) {
    values[row.id] = valueOf(row, read.get(row.settingKey));
  }
  for (const id of CUSTOM_IDS) {
    values[id] = customValueOf(read.get(settingKeyOf(id)));
  }
  for (const id of WEIGHT_IDS) {
    values[id] = weightValueOf(read.get(settingKeyOf(id)));
  }
  return values as AppearanceValues;
}

/** theme file 묶음에서 고를 수 있는 theme과 쓸 수 없는 file. core가 읽지 못한 file도 쓸 수 없는 file로 보인다. */
export function themesOf(folder: SettingFolderView): Themes {
  const themes = loadThemes(
    folder.entries.map((entry) => ({
      id: entry.id,
      text: JSON.stringify(entry.value),
    })),
  );
  return {
    list: themes.list,
    broken: [
      ...themes.broken,
      ...folder.unreadable.map((one) => ({ id: one.name, reason: one.reason })),
    ],
  };
}

export function coreAppearanceSource(
  core: CoreSource,
  queryFonts: QueryLocalFonts | undefined,
  appearance: AppearanceApi | undefined,
): AppearanceSource {
  return {
    watch: (listener) => core.subscribe(listener),

    async values() {
      const read = await readEffective(core, APPEARANCE_KEYS);
      return read.ok
        ? { ok: true, value: appearanceValuesOf(read.value) }
        : read;
    },

    choose(id, value) {
      return chooseSetting(core, settingKeyOf(id), value);
    },

    fonts: () => installedFonts(queryFonts),

    openThemesFolder: () => appearance?.openThemesFolder(),
  };
}
