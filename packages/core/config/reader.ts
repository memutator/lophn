import { readFileSync } from "node:fs";
import type { z } from "zod";
import type {
  SettingDeclaration,
  SettingsReader,
} from "../../protocol/config/mod.ts";
import { SETTINGS_FILE_NAME } from "../../protocol/config/mod.ts";
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

function valueOrDefault<S extends z.ZodType>(
  setting: SettingDeclaration<S>,
  chosen: unknown,
): z.output<S> | undefined {
  const picked =
    chosen !== undefined && setting.type.safeParse(chosen).success
      ? chosen
      : setting.default;
  return picked === undefined ? undefined : setting.type.parse(picked);
}

/**
 * writer·reader Worker처럼 store가 없는 곳의 reader. 부를 때마다 `<root>/settings.json`을 읽는다.
 * 읽지 못하거나 모양이 틀린 값은 선택이 없는 것과 같다(기본값).
 */
export function createFileSettingsReader(root: string): SettingsReader {
  return {
    get<S extends z.ZodType>(
      setting: SettingDeclaration<S>,
    ): z.output<S> | undefined {
      let chosen: unknown;
      try {
        const file = JSON.parse(
          readFileSync(`${root}/${SETTINGS_FILE_NAME}`, "utf8"),
        );
        chosen = file?.[setting.key];
      } catch {
        chosen = undefined;
      }
      return valueOrDefault(setting, chosen);
    },
  };
}

/** `settings/list` 응답 항목에서 만든 reader. agent runtime child처럼 core를 HTTP로 부르는 쪽이 쓴다. */
export function createListSettingsReader(
  entries: readonly { key: string; chosen?: unknown }[],
): SettingsReader {
  return {
    get<S extends z.ZodType>(
      setting: SettingDeclaration<S>,
    ): z.output<S> | undefined {
      const entry = entries.find((one) => one.key === setting.key);
      return valueOrDefault(setting, entry?.chosen);
    },
  };
}
