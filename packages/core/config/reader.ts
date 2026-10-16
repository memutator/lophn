import type { z } from "zod";
import type {
  SettingDeclaration,
  SettingsReader,
} from "../../protocol/config/mod.ts";
import type { SettingsStore } from "./store.ts";

/** 파일에 고른 값이 있으면 그 값, 없으면 선언의 기본값, 둘 다 없으면 undefined. */
export function createSettingsReader(
  store: Pick<SettingsStore, "chosen">,
): SettingsReader {
  return {
    get<S extends z.ZodType>(
      setting: SettingDeclaration<S>,
    ): z.output<S> | undefined {
      const chosen = store.chosen()[setting.key];
      const value = chosen !== undefined ? chosen : setting.default;
      return value === undefined ? undefined : setting.type.parse(value);
    },
  };
}
