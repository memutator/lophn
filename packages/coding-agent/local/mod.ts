import { HARNESS_COMMANDS } from "./harness.ts";
import { HOOK_COMMANDS } from "./hook.ts";
import type { LocalCommand } from "./types.ts";

export type { LocalCommand, LocalContext, LocalCore } from "./types.ts";

export const LOCAL_COMMANDS: readonly LocalCommand[] = [
  ...HOOK_COMMANDS,
  ...HARNESS_COMMANDS,
];
