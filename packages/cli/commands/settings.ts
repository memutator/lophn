// `lophn settings get`: 지금 설정 값과 뜻을 읽는다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { settingsList } from "../../protocol/config/mod.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { defineCommand } from "./types.ts";

const get = defineCommand({
  name: "settings.get",
  summary: "Read settings",
  description:
    "Read the current setting values and what they mean. Without key all settings, with key that one.",
  input: z.strictObject({
    key: z
      .string()
      .refine((value) => value.trim().length > 0, {
        message: "expected nonblank text",
      })
      .optional(),
  }),
  positional: ["key"],
  effect: "read",
  routes: [settingsList],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(
      settingsList,
      input.key === undefined ? {} : { keys: [input.key] },
    );
    if (!read.ok) return read;
    return ok({
      summary: `${read.value.settings.length} settings`,
      content: read.value,
      arrayKeys: ["settings"],
    });
  },
});

export const SETTINGS_COMMANDS = [get];
