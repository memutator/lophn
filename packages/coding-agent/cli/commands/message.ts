// `lophn message send`: 일을 맡긴 App Engineer session에 메시지를 보낸다. 보내는 session은 token이 정한다.
import { type CommandEntry, entryOf } from "./types.ts";

export const MESSAGE_COMMANDS: readonly CommandEntry[] = [
  entryOf("message send", "맡긴 App Engineer에게 메시지를 보낸다"),
];
