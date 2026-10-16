import { ok } from "../../../../base/mod.ts";
import { settingsGet } from "../../../../protocol/config/mod.ts";
import { readOf } from "../../run-loop/core-call.ts";
import { guideText, guideTopics } from "../../roles/guides.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolInput } from "../domain/input.ts";
import { fitted, notFound, readBody } from "../domain/result.ts";
import { limitText } from "../result.ts";
import { defineBuiltin } from "./common.ts";

export const GUIDE_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "guide.read",
    description:
      "Read the product guide. Without topic it lists the topics; with a topic it returns that guide.",
    effect: "read",
    handler: (input) => {
      const { topic } = input as ToolInput<"guide.read">;
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
  defineBuiltin({
    name: "settings.get",
    description:
      "Read the current setting values and what they mean. Without key all settings, with key that one.",
    effect: "read",
    handler: async (input, ctx) => {
      const { key } = input as ToolInput<"settings.get">;
      const read = await readOf(
        ctx.core,
        settingsGet,
        key === undefined ? {} : { keys: [key] },
      );
      if (!read.ok) return read;
      const { body } = readBody(read.value);
      return ok(fitted(`${body.settings.length} settings`, body, ["settings"]));
    },
  }),
];
