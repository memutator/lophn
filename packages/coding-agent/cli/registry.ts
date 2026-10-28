// CLI command registry다. 사람 help(`help.ts`)와 실행(`main.ts`)이 같은 표를 쓴다. 이름·입력·인증은
// `CODING_CLI_COMMANDS`(protocol)와 같다. 표 밖 command는 실행 전 거절이다.
import { CODING_CLI_COMMANDS } from "../../protocol/coding-agent/mod.ts";
import { HARNESS_COMMANDS } from "./commands/harness.ts";
import { HOOK_COMMANDS } from "./commands/hook.ts";
import { RUN_COMMANDS } from "./commands/run.ts";
import { WORKFLOW_COMMANDS } from "./commands/workflow.ts";
import type { CommandEntry } from "./commands/types.ts";

export const COMMANDS: readonly CommandEntry[] = [
  ...HOOK_COMMANDS,
  ...HARNESS_COMMANDS,
  ...RUN_COMMANDS,
  ...WORKFLOW_COMMANDS,
];

// 표와 어긋나면 기동 때 바로 드러난다.
{
  const table = CODING_CLI_COMMANDS.map((command) => command.name).sort();
  const ours = COMMANDS.map((entry) => entry.name).sort();
  if (JSON.stringify(table) !== JSON.stringify(ours)) {
    throw new Error("cli registry differs from CODING_CLI_COMMANDS");
  }
}

export function findCommand(name: string): CommandEntry | undefined {
  return COMMANDS.find((entry) => entry.name === name);
}

// 위치 인자에서 표에 있는 가장 긴 command 이름을 찾는다(가장 긴 이름은 두 단어다).
export function matchCommand(
  words: readonly string[],
): { entry: CommandEntry; used: number } | undefined {
  for (let size = Math.min(2, words.length); size >= 1; size -= 1) {
    const entry = findCommand(words.slice(0, size).join(" "));
    if (entry !== undefined) return { entry, used: size };
  }
  return undefined;
}

export type { CommandEntry };
