// coding-agent/cli의 public entry다. 조립이 쓰는 것만 내보낸다.
export type { CommandEntry } from "./registry.ts";
export { COMMANDS, findCommand } from "./registry.ts";
export { parseArgs } from "./parser.ts";
export type { ParsedArgs } from "./parser.ts";
export { CLI_EXITS, createOutput, exitOf } from "./output.ts";
export type { OutputOptions, OutputWriter } from "./output.ts";
export { helpJson, helpText } from "./help.ts";
export { cliMain } from "./main.ts";
export type { CliOptions } from "./main.ts";
export {
  CLI_ENTRY,
  CLI_ENV_NAMES,
  cliLaunchArgv,
  cliStaticFlags,
  NO_SELECTION,
  planSelection,
  selectionFlags,
} from "./launch.ts";
export type { CliLaunchInputs, CliSelection } from "./launch.ts";
