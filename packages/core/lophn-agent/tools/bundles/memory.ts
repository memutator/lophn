import { z } from "zod";
import { editMemory } from "../memory/edit.ts";
import type { FileHooks } from "../ports.ts";
import { defineTool, type ToolDefinition } from "../spi.ts";

// memory 파일 하나(lophn이면 자기 workspace의 memory, 사람이 만든 agent면 자기 agent memory)를 쓰는 tool 하나다.
export const createMemoryTools = (
  hooks: FileHooks,
): readonly ToolDefinition[] => [
  defineTool({
    name: "agent.memory",
    input: z.strictObject({
      old_string: z.string().optional(),
      new_string: z.string(),
    }),
    routes: [],
    description:
      "Edit your memory, a small notes file that is put in your system prompt at the start of each session. Without old_string, new_string is appended. With old_string, it is replaced by new_string (it must appear exactly once; an empty new_string deletes it). The file is limited to 8 KiB; a write over it is rejected. The change shows from the next session, not in this one.",
    effect: "write",
    handler: (input, ctx) => editMemory(input, ctx, hooks),
  }),
];
