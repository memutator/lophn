// AppearanceSource를 선언 설정(`shell.*`)의 읽기·쓰기로 만든다. 설치된 글꼴은 받은 queryLocalFonts로 읽고,
// theme 목록은 core 설정의 항목(`shell.themes`)을 main과 같은 규칙(loadThemes)으로 푼 것이다.
import { loadThemes } from "@lophn/ui";

import {
  type AppearanceApi,
  THEMES_SETTING_KEY,
} from "../../../../ipc/appearance.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { chooseSetting, readEffective, readFolder } from "../declared.ts";
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

export function coreAppearanceSource(
  core: CoreSource,
  queryFonts: QueryLocalFonts | undefined,
  appearance: AppearanceApi | undefined,
): AppearanceSource {
  return {
    watch: (listener) => core.subscribe(listener),

    async values() {
      const read = await readEffective(core, [
        ...APPEARANCE_ROWS.map((row) => row.settingKey),
        ...CUSTOM_IDS.map(settingKeyOf),
        ...WEIGHT_IDS.map(settingKeyOf),
      ]);
      if (!read.ok) return read;
      const values: Record<string, string> = { ...APPEARANCE_DEFAULTS };
      for (const row of APPEARANCE_ROWS) {
        values[row.id] = valueOf(row, read.value.get(row.settingKey));
      }
      for (const id of CUSTOM_IDS) {
        values[id] = customValueOf(read.value.get(settingKeyOf(id)));
      }
      for (const id of WEIGHT_IDS) {
        values[id] = weightValueOf(read.value.get(settingKeyOf(id)));
      }
      return { ok: true, value: values as AppearanceValues };
    },

    choose(id, value) {
      return chooseSetting(core, settingKeyOf(id), value);
    },

    fonts: () => installedFonts(queryFonts),

    async themes() {
      const read = await readFolder(core, THEMES_SETTING_KEY);
      if (!read.ok) return loadThemes([]);
      const themes = loadThemes(
        read.value.entries.map((entry) => ({
          id: entry.id,
          text: JSON.stringify(entry.value),
        })),
      );
      // core가 읽지 못한 file(이름, 크기, JSON)도 쓸 수 없는 file로 같이 보인다.
      return {
        list: themes.list,
        broken: [
          ...themes.broken,
          ...read.value.unreadable.map((one) => ({
            id: one.name,
            reason: one.reason,
          })),
        ],
      };
    },

    openThemesFolder: () => appearance?.openThemesFolder(),
  };
}
