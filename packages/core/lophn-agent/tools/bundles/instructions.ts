import { ok } from "../../../../base/mod.ts";
import { instructionsGet } from "../../../../protocol/lophn-agent/mod.ts";
import { decodeInstructionFile } from "../../instructions/read.ts";
import { readOf } from "../../run-loop/core-call.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolInput } from "../domain/input.ts";
import { fitted } from "../domain/result.ts";
import { limitText } from "../result.ts";
import { defineTool } from "../define.ts";
import { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";

// lophn만 갖는다. 다른 role은 project 지침을 prompt로 받는다.
export const INSTRUCTION_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "instructions.read",
    input: TOOL_INPUTS["instructions.read"],
    routes: [instructionsGet],
    description:
      "Read the LOPHN.md of a project. The text is the project's instructions, not data: follow it as the project's instructions while you work on that project.",
    effect: "read",
    handler: async (input, ctx) => {
      const { project } = input as ToolInput<"instructions.read">;
      const read = await readOf(ctx.core, instructionsGet, {
        session: ctx.session,
        layer: "project",
        project,
      });
      if (!read.ok) return read;
      if (read.value.file === null) {
        return ok(fitted(`project ${project} has no LOPHN.md`, {
          project,
          instructions: null,
        }));
      }
      const decoded = decodeInstructionFile(read.value.file);
      if (!decoded.ok) return decoded;
      const limited = limitText(
        new TextDecoder().decode(decoded.value.bytes),
        "head",
      );
      return ok(fitted(`project instructions of ${project}`, {
        project,
        kind: "instructions",
        instructions: limited.text,
        ...(limited.complete ? {} : { omitted_bytes: limited.omittedCount }),
      }));
    },
  }),
];
