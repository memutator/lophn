import { ok } from "../../../../base/mod.ts";
import type { ToolInput } from "../domain/input.ts";
import { fitted } from "../domain/result.ts";
import type { ToolDefinition } from "../registry.ts";
import { limitText } from "../result.ts";
import { defineBuiltin } from "./common.ts";

export const SKILL_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "skill.read",
    description:
      "Read a skill by name. Without path it returns the skill body; with path it returns a file that comes with the skill. A turn that is running reads the version the turn started with. A skill that is off cannot be read.",
    effect: "read",
    handler: async (input, ctx) => {
      const { name, path } = input as ToolInput<"skill.read">;
      const read = await ctx.skills.read(ctx.session, name, path);
      if (!read.ok) return read;
      const limited = limitText(read.value, "head");
      return ok(fitted(`skill ${name}${path === undefined ? "" : ` ${path}`}`, {
        text: limited.text,
        ...(limited.complete ? {} : { omitted_bytes: limited.omittedCount }),
      }));
    },
  }),
];
