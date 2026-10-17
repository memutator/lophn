// `lophn release`: 지금 claim 아래에서 release를 준비하고 준비 진행·확정된 release를 읽는다.
import { type CommandEntry, entryOf } from "./types.ts";

export const RELEASE_COMMANDS: readonly CommandEntry[] = [
  entryOf("release prepare", "claim 아래에서 release를 준비한다"),
  entryOf("release status", "release 준비 진행과 확정된 release를 읽는다"),
];
