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
export { APP_COMMANDS, CLI_APP_OPS, runApp } from "./commands/app.ts";
export type { CliAppName } from "./commands/app.ts";
export {
  CLI_SDK_OPS,
  runSdk,
  SDK_COMMANDS,
  sdkOpInput,
} from "./commands/sdk.ts";
export type { CliSdkName } from "./commands/sdk.ts";
export {
  CLI_ENTRY,
  CLI_ENV_NAMES,
  cliLaunchArgv,
  cliStaticFlags,
  NO_SELECTION,
  planSelection,
  selectionFlags,
} from "./launch.ts";
export type {
  CliLaunchInputs,
  CliSelection,
  SelectionDeps,
  SelectionRequest,
} from "./launch.ts";
