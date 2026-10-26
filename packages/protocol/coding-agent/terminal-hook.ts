// 터미널 안에서 돈 harness hook이 그 터미널을 가진 shell main에 닿는 길의 계약이다. `lophn hook`이
// 보내고 shell main이 받는다. 사람이 연 터미널이든 lophn이 띄운 coding 터미널이든 같은 길이고,
// coding 터미널의 hook은 shell main이 core에 넘긴다(`codingTerminalHook`).
import { z } from "zod";
import { jsonValueSchema } from "../base/json-values.ts";
import { harnessIdSchema } from "./harnesses.ts";

// shell main이 터미널마다 넣는 env. 이름이 `LOPHN_`이 아닌 것은 터미널 env가 바깥 `LOPHN_*`를 지우기 때문이다.
export const TERMINAL_HOOK_ENV = "LPN_TERMINAL_HOOK";

export const HOOK_EVENT_MAX_CHARS = 80;
export const HOOK_PAYLOAD_MAX_BYTES = 65_536;
// CLI가 stdin에서 읽는 상한. 긴 마지막 답이 turn 끝 신호를 막지 않게 읽은 뒤 긴 글 field를 잘라 PAYLOAD 상한에 맞춘다.
export const HOOK_STDIN_MAX_BYTES = HOOK_PAYLOAD_MAX_BYTES * 16;
// 이보다 긴 최상위 글 field(마지막 답, prompt)는 보내기 전에 자른다. 쓰는 쪽은 앞 1,024자만 본다.
export const HOOK_TEXT_FIELD_MAX_CHARS = 4_096;
// 줄 하나의 상한. payload 상한에 envelope 몫을 더했다.
export const TERMINAL_HOOK_LINE_MAX_BYTES = HOOK_PAYLOAD_MAX_BYTES + 1_024;
export const TERMINAL_HOOK_KEY_PATTERN = /^[0-9a-f]{64}$/;

// env 값(JSON). socket은 shell main이 연 unix socket, key는 터미널 하나에 준 값이다.
export const terminalHookEnvSchema = z.strictObject({
  socket: z.string().min(1).max(4096),
  key: z.string().regex(TERMINAL_HOOK_KEY_PATTERN),
});
export type TerminalHookEnv = z.infer<typeof terminalHookEnvSchema>;

// socket에 쓰는 줄 하나(JSON 끝에 `\n`). 답은 없고 shell main이 연결을 닫는다. 모르는 key는 버린다.
export const terminalHookLineSchema = z.strictObject({
  v: z.literal(1),
  key: z.string().regex(TERMINAL_HOOK_KEY_PATTERN),
  harness: harnessIdSchema,
  event: z.string().min(1).max(HOOK_EVENT_MAX_CHARS),
  payload: jsonValueSchema,
});
export type TerminalHookLine = z.infer<typeof terminalHookLineSchema>;
