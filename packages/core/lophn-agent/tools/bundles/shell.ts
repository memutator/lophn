import { runShell } from "../shell/run.ts";
import { defineTool, type ToolDefinition } from "../spi.ts";
import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

// place의 첫 폴더에서 명령을 돌린다. OS sandbox는 없다. shell 규칙으로 판정한다.
export const SHELL_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "shell.run",
    input: z.strictObject({
      command: nonblank,
      timeout_ms: z.number().int().positive().optional(),
    }),
    routes: [],
    description:
      "Run a shell command with /bin/sh in the place's first folder. Environment variables are limited and secrets are not available. timeout_ms defaults to 120000 and is at most 600000. Output is capped at about 24 KiB per stream: the first and last 12 KiB are kept and the middle is omitted.",
    // 판정은 효과가 아니라 shell 규칙이 한다. read면 일시 실패에 다시 돌아 같은 명령이 두 번 돈다.
    effect: "external",
    gate: (input) => ({ kind: "shell", command: input.command }),
    handler: (input, ctx) => runShell(input, ctx),
  }),
];
