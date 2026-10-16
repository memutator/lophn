// `lophn release prepare`: 지금 claim 아래에서 release를 준비한다.
import { type CommandEntry, entryOf } from "./types.ts";

export const RELEASE_COMMANDS: readonly CommandEntry[] = [
  entryOf("release prepare", "claim 아래에서 release를 준비한다"),
];
