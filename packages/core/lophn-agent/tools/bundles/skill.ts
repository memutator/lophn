import { ok } from "../../../../base/mod.ts";
import type { ToolInput } from "../domain/input.ts";
import { fitted } from "../domain/result.ts";
import type { ToolDefinition } from "../registry.ts";
import { limitText } from "../result.ts";
import { inputJsonSchema } from "../wire.ts";
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
  defineBuiltin({
    name: "tool.search",
    description:
      "Get the description and input schema of tools whose definition is not in the prompt. names are canonical tool names such as file.read.",
    effect: "read",
    handler: (input, ctx) => {
      const { names } = input as ToolInput<"tool.search">;
      const found = names.map((name) =>
        ctx.listed.find((tool) => tool.name === name)
      );
      const unknown = names.filter((_, index) => found[index] === undefined);
      if (unknown.length > 0) {
        return Promise.resolve(ok({
          status: "failure",
          summary: `unknown_tool: ${unknown.join(", ")}`,
          content: null,
          complete: true,
          source: null,
          continuation: null,
          pending: [],
        }));
      }
      return Promise.resolve(ok(fitted(
        `${names.length} tools`,
        {
          tools: found.map((tool) => ({
            name: tool!.name,
            description: tool!.description,
            input_schema: inputJsonSchema(tool!),
          })),
        },
        ["tools"],
      )));
    },
  }),
];
