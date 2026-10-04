// coding-agent/cli의 public entry다(code-map). 조립이 쓰는 것만 내보낸다.
// app SDK import는 승인되지 않았으므로 workspace member 직접 참조를 쓰지 않는다.
export type { CommandEntry } from "./registry.ts";
export { COMMANDS, findCommand } from "./registry.ts";
export {
  emptyParsedArgs,
  HELP_COMMAND,
  parseArgs,
  splitCommand,
  VERSION_COMMAND,
} from "./parser.ts";
export type { CommandRef, ParsedArgs } from "./parser.ts";
export { CLI_EXITS, createOutput } from "./output.ts";
export type { OutputOptions, OutputWriter } from "./output.ts";
export { COMMAND_HELP, commandHelp, helpJson, helpText } from "./help.ts";
