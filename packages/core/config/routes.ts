// settings/list·settings/update. 거절 결과와 오류에 입력한 값을 싣지 않는다.
import { err, ok } from "../../base/mod.ts";
import { z } from "zod";
import {
  type SettingEntry,
  type SettingFolder,
  settingsList,
  settingsUpdate,
} from "../../protocol/config/mod.ts";
import type { MemoryHandler } from "../server/mod.ts";
import type { SettingsStore } from "./store.ts";

const jsonSchemaOf = (type: z.ZodType) =>
  z.toJSONSchema(type, { unrepresentable: "any" }) as SettingEntry["type"];

export function settingsListHandler(
  store: Pick<SettingsStore, "registry" | "chosen" | "folder">,
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
          description: one.description,
          ...(one.locked === true ? { locked: true } : {}),
          type: jsonSchemaOf(one.type),
          ...(one.default === undefined
            ? {}
            : { default: one.default as never }),
          ...(chosen[one.key] === undefined
            ? {}
            : { chosen: chosen[one.key] as never }),
        }),
      );
    const folders = store.registry
      .folders()
      .filter((one) => asked === undefined || asked.has(one.key))
      .map((one): SettingFolder => {
        const state = store.folder(one);
        return {
          key: one.key,
          description: one.description,
          ...(one.locked === true ? { locked: true } : {}),
          folder: one.folder,
          type: jsonSchemaOf(one.type),
          entries: Object.entries(state.values).map(([id, value]) => ({
            id,
            value: value as never,
          })),
          unreadable: [...state.unreadable],
        };
      });
    return ok({ settings, folders });
  };
}

export function settingsUpdateHandler(
  store: Pick<SettingsStore, "registry" | "update">,
): MemoryHandler {
  return (ctx, rawInput) => {
    const input = settingsUpdate.input.safeParse(rawInput);
    if (!input.success) {
      return err({
        code: "invalid_input",
        message: "settings update is not valid",
      });
    }
    // agent가 자기 범위를 정하는 설정을 바꾸지 못하게 한다. 사람(Settings 화면)은 지난다.
    if (ctx.actor.startsWith("agent:")) {
      const locked = input.data.changes.filter((change) =>
        store.registry.locked(change.key),
      );
      if (locked.length > 0) {
        return ok({
          changed: [],
          rejected: locked.map((change) => ({
            key: change.key,
            reason: "locked" as const,
          })),
          notes: [],
        });
      }
    }
    return store.update(input.data.changes);
  };
}
