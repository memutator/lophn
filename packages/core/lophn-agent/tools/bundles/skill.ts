import { ok } from "../../../../base/mod.ts";
import { defineTool, type ToolDefinition } from "../spi.ts";
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
    // 본문과 딸린 file은 읽을 때 이미 크기 상한(SKILL_BODY_MAX_BYTES) 안이라 tool 결과 상한(줄 수, JSON bytes)을
    // 걸지 않는다. 걸면 model이 이어 읽을 길 없이 지침의 끝을 잃는다(300줄에서 잘린 일이 있다).
    handler: async (input, ctx) => {
      const { name, path } = input;
      const read = await ctx.skills.read(ctx.session, name, path);
      if (!read.ok) return read;
      return ok({
        status: "success",
        summary: `skill ${name}${path === undefined ? "" : ` ${path}`}`,
        content: { text: read.value },
        complete: true,
        source: null,
        continuation: null,
        pending: [],
      });
    },
  }),
];
