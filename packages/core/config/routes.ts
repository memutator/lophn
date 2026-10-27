// settings/list·settings/update. 거절 결과와 오류에 입력한 값을 싣지 않는다.
import { err, ok } from "../../base/mod.ts";
import { z } from "zod";
import {
  type SettingEntry,
  settingsList,
  settingsUpdate,
} from "../../protocol/config/mod.ts";
import type { MemoryHandler } from "../server/mod.ts";
import type { SettingsStore } from "./store.ts";

export function settingsListHandler(
  store: Pick<SettingsStore, "registry" | "chosen">,
): MemoryHandler {
  return (_ctx, rawInput) => {
    const input = settingsList.input.safeParse(rawInput);
    if (!input.success) {
      return err({
        code: "invalid_input",
        message: "settings list is not valid",
      });
    }
    const asked =
      input.data.keys === undefined ? undefined : new Set(input.data.keys);
    const chosen = store.chosen();
    const settings = store.registry
      .declarations()
      .filter((one) => asked === undefined || asked.has(one.key))
      .map(
        (one): SettingEntry => ({
          key: one.key,
          type: z.toJSONSchema(one.type, {
            unrepresentable: "any",
          }) as SettingEntry["type"],
          ...(one.default === undefined
            ? {}
            : { default: one.default as never }),
          ...(chosen[one.key] === undefined
            ? {}
            : { chosen: chosen[one.key] as never }),
        }),
      );
    return ok({ settings });
  };
}

export function settingsUpdateHandler(
  store: Pick<SettingsStore, "update">,
): MemoryHandler {
  return (_ctx, rawInput) => {
    const input = settingsUpdate.input.safeParse(rawInput);
    if (!input.success) {
      return err({
        code: "invalid_input",
        message: "settings update is not valid",
      });
    }
    return store.update(input.data.changes);
  };
}
