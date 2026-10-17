import { ok } from "../../../base/mod.ts";
import { settingsList } from "../../../protocol/config/mod.ts";
import { guideText, guideTopics } from "../../lophn-agent/roles/guides.ts";
import {
  defineTool,
  fitted,
  limitText,
  notFound,
  readOf,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

export const GUIDE_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "guide.read",
    input: z.strictObject({ topic: nonblank.optional() }),
    routes: [],
    description:
      "Read the product guide. Without topic it lists the topics; with a topic it returns that guide.",
    effect: "read",
    handler: (input) => {
      const { topic } = input;
      if (topic === undefined) {
        return Promise.resolve(
          ok(fitted("guide topics", { topics: guideTopics() })),
        );
      }
      const text = guideText(topic);
      if (text === undefined) {
        return Promise.resolve(notFound("guide topic not found"));
      }
      const limited = limitText(text, "head");
      return Promise.resolve(ok(fitted(`guide ${topic}`, {
        topic,
        text: limited.text,
        ...(limited.complete ? {} : { omitted_bytes: limited.omittedCount }),
      })));
    },
  }),
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
