// AppearanceSource를 선언 설정(`shell.*`)의 읽기·쓰기로 만든다.
import type { CoreSource } from "../../connection/connection.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_ROWS,
  CUSTOM_IDS,
  customValueOf,
  settingKeyOf,
  valueOf,
} from "./model.ts";
import type { AppearanceSource, AppearanceValues } from "./source.ts";

export function coreAppearanceSource(core: CoreSource): AppearanceSource {
  return {
    watch: (listener) => core.subscribe(listener),

    async values() {
      const read = await readEffective(core, [
        ...APPEARANCE_ROWS.map((row) => row.settingKey),
        ...CUSTOM_IDS.map(settingKeyOf),
      ]);
      if (!read.ok) return read;
      const values: Record<string, string> = { ...APPEARANCE_DEFAULTS };
      for (const row of APPEARANCE_ROWS) {
        values[row.id] = valueOf(row, read.value.get(row.settingKey));
      }
      for (const id of CUSTOM_IDS) {
        values[id] = customValueOf(read.value.get(settingKeyOf(id)));
      }
      return { ok: true, value: values as AppearanceValues };
    },

    choose(id, value) {
      return chooseSetting(core, settingKeyOf(id), value);
    },
  };
}
