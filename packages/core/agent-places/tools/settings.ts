import { ok } from "../../../base/mod.ts";
import { settingsList } from "../../../protocol/config/mod.ts";
import {
  defineTool,
  fitted,
  readOf,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

export const SETTINGS_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "settings.get",
    input: z.strictObject({ key: nonblank.optional() }),
    routes: [settingsList],
    description:
      "Read the current setting values and what they mean. Without key all settings, with key that one.",
    effect: "read",
    handler: async (input, ctx) => {
      const { key } = input;
      const read = await readOf(
        ctx.core,
        settingsList,
        key === undefined ? {} : { keys: [key] },
      );
      if (!read.ok) return read;
      const body = read.value;
      return ok(fitted(`${body.settings.length} settings`, body, ["settings"]));
    },
  }),
];
