import { ok } from "../../../../base/mod.ts";
import { defineTool, fitted, limitText, type ToolDefinition } from "../spi.ts";
import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const path = z.string().min(1);

export const SKILL_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "skill.read",
    input: z.strictObject({ name: nonblank, path: path.optional() }),
    routes: [],
    description:
      "Read an enabled skill. Omit path to get the skill body. path reads a bundled .md file that ships beside SKILL.md. Uses the version captured at turn start.",
    effect: "read",
    handler: async (input, ctx) => {
      const { name, path } = input;
      const read = await ctx.skills.read(ctx.session, name, path);
      if (!read.ok) return read;
      const limited = limitText(read.value, "head");
      return ok(
        fitted(`skill ${name}${path === undefined ? "" : ` ${path}`}`, {
          text: limited.text,
          ...(limited.complete ? {} : { omitted_bytes: limited.omittedCount }),
        }),
      );
    },
  }),
];
