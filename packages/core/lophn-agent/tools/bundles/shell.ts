import { shellCategory } from "../shell/classify.ts";
import { runShell } from "../shell/run.ts";
import { defineTool, type ToolDefinition } from "../spi.ts";
import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

// model이 채우는 짧은 설명이다. 사람이 읽는 tool 줄 제목에만 쓰고 승인 카드에는 싣지 않는다.
const SHELL_DESCRIPTION = `What this command does, in active voice, shown to the person instead of the command. For simple commands use 5-10 words, e.g. ls → "List files in current directory", git status → "Show working tree status". For piped commands or obscure flags add enough context, e.g. curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements". Say what it does in plain words: do not repeat the command, its flags or file paths.`;

// 제목은 model이 쓴 설명이고, 비어 있으면 명령의 첫 줄이다.
function shellTitle(input: { command: string; description?: string }): string {
  const description = input.description?.trim() ?? "";
  if (description !== "") return description;
  const firstLine = input.command
    .split("\n")
    .find((line) => line.trim() !== "");
  return (firstLine ?? input.command).trim();
}

// place의 첫 폴더에서 명령을 돌린다. OS sandbox는 없다. shell 규칙으로 판정한다.
export const SHELL_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "shell.run",
    input: z.strictObject({
      command: nonblank,
      timeout_ms: z.number().int().positive().optional(),
      description: z.string().optional().describe(SHELL_DESCRIPTION),
    }),
    routes: [],
    description:
      "Run a shell command with /bin/sh in the place's first folder. Environment variables are limited and secrets are not available. timeout_ms defaults to 120000 and is at most 600000. Output is capped at about 24 KiB per stream: the first and last 12 KiB are kept and the middle is omitted.",
    // 판정은 효과가 아니라 shell 규칙이 한다. read면 일시 실패에 다시 돌아 같은 명령이 두 번 돈다.
    effect: "external",
    // 승인 카드는 program이 이 호출에서 만든다. `description`을 싣지 않는다.
    gate: (input) => ({ kind: "shell", command: input.command }),
    display: (input) => ({
      category: shellCategory(input.command),
      title: shellTitle(input),
    }),
    handler: (input, ctx) => runShell(input, ctx),
  }),
];
