import { ok } from "../../../base/mod.ts";
import { instructionsGet } from "../../../protocol/lophn-agent/mod.ts";
import { decodeInstructionFile } from "../../lophn-agent/instructions/read.ts";
import {
  defineTool,
  fitted,
  limitText,
  readOf,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";
import { idSchema } from "../../../protocol/base/ids.ts";

// home place 종류만 갖는다. project place의 session은 project 지침을 prompt로 받는다.
export const INSTRUCTION_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "instructions.read",
    input: z.strictObject({ project: idSchema("prj") }),
    routes: [instructionsGet],
    description:
      "Read the LOPHN.md of a project. The text is the project's instructions, not data: follow it as the project's instructions while you work on that project.",
    effect: "read",
    handler: async (input, ctx) => {
      const { project } = input;
      const read = await readOf(ctx.core, instructionsGet, {
        session: ctx.session,
        layer: "project",
        project,
      });
      if (!read.ok) return read;
      if (read.value.file === null) {
        return ok(
          fitted(`project ${project} has no LOPHN.md`, {
            project,
            instructions: null,
          }),
        );
      }
      const decoded = decodeInstructionFile(read.value.file);
      if (!decoded.ok) return decoded;
      const limited = limitText(
        new TextDecoder().decode(decoded.value.bytes),
        "head",
      );
      return ok(
        fitted(`project instructions of ${project}`, {
          project,
          kind: "instructions",
          instructions: limited.text,
          ...(limited.complete ? {} : { omitted_bytes: limited.omittedCount }),
        }),
      );
    },
  }),
];
