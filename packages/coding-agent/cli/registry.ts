// CLI command registry다(T12, architecture 5.4). 사람 help(`help.ts`)와 기계
// dispatch가 같은 표에서 나온다. 표 밖 command·op는 실행 전 거절이다(cli#R4).
// route는 contracts의 소유 table 값 그대로다. 임의 core API passthrough는 없다
// (cli#R1, architecture 5.1).
import { CONTEXT_COMMANDS } from "./commands/context.ts";
import { APPROVAL_COMMANDS, QUESTION_COMMANDS } from "./commands/decisions.ts";
import { DAEMON_COMMANDS } from "./commands/daemon.ts";
import { DOCTOR_COMMANDS } from "./commands/doctor.ts";
import { DOCUMENT_COMMANDS, READ_COMMANDS } from "./commands/document.ts";
import { HARNESS_COMMANDS } from "./commands/harness.ts";
import type { CommandEntry } from "./commands/types.ts";
import { FORMAT_COMMANDS } from "./commands/format.ts";
import { INDEX_COMMANDS } from "./commands/index.ts";
import { MCP_COMMANDS } from "./commands/mcp.ts";
import { PROJECT_COMMANDS } from "./commands/project.ts";
import { SAVE_COMMANDS } from "./commands/save.ts";
import { SERIES_COMMANDS } from "./commands/series.ts";
import { TICKET_COMMANDS } from "./commands/ticket.ts";

// command 표 하나다. name은 `lophn <group> <command>`의 `<group> <command>`다.
export const COMMANDS: readonly CommandEntry[] = [
  ...INDEX_COMMANDS,
  ...READ_COMMANDS,
  ...DOCUMENT_COMMANDS,
  ...SAVE_COMMANDS,
  ...PROJECT_COMMANDS,
  ...FORMAT_COMMANDS,
  ...SERIES_COMMANDS,
  ...CONTEXT_COMMANDS,
  ...QUESTION_COMMANDS,
  ...APPROVAL_COMMANDS,
  ...TICKET_COMMANDS,
  ...DAEMON_COMMANDS,
  ...DOCTOR_COMMANDS,
  ...HARNESS_COMMANDS,
  ...MCP_COMMANDS,
];

export function findCommand(name: string): CommandEntry | undefined {
  return COMMANDS.find((entry) => entry.name === name);
}

export type { CommandEntry };
