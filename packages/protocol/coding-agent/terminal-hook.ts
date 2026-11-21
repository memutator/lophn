// 터미널 안에서 돈 harness hook이 그 터미널을 가진 core에 닿는 길의 계약이다. `lophn hook`이
// 보내고 core의 terminal agents가 받는다. 사람이 연 터미널이든 GUI가 띄운 CLI든 같은 길이다.
import { z } from "zod";
import { jsonValueSchema } from "../base/json-values.ts";
import { absolutePathSchema } from "../projects/values.ts";
import { harnessIdSchema } from "./harnesses.ts";

// core가 터미널마다 넣는 env. 이름이 `LOPHN_`이 아닌 것은 터미널 env가 바깥 `LOPHN_*`를 지우기 때문이다.
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

// env 값(JSON). socket은 core의 POSIX unix socket 또는 Windows named pipe, key는 터미널 하나에 준 값이다.
export const terminalHookEnvSchema = z.strictObject({
  socket: z.string().min(1).max(4096),
  key: z.string().regex(TERMINAL_HOOK_KEY_PATTERN),
});
export type TerminalHookEnv = z.infer<typeof terminalHookEnvSchema>;

// socket에 쓰는 줄 하나(JSON 끝에 `\n`). 답은 없고 core가 연결을 닫는다. 모르는 key는 버린다.
export const terminalHookLineSchema = z.strictObject({
  v: z.literal(1),
  key: z.string().regex(TERMINAL_HOOK_KEY_PATTERN),
  harness: harnessIdSchema,
  event: z.string().min(1).max(HOOK_EVENT_MAX_CHARS),
  payload: jsonValueSchema,
});
export type TerminalHookLine = z.infer<typeof terminalHookLineSchema>;

// 탭에서 친 `<harness> --gui`가 그 탭을 GUI로 바꿔 달라는 요청이다. 같은 hook socket을 쓰고 event 이름만 다르다.
// `cwd`는 `lophn hook`이 그 함수를 친 shell의 폴더로 더한다(main은 shell이 `cd`한 뒤의 폴더를 모른다).
export const TERMINAL_GUI_EVENT = "lophn-gui";
export const terminalGuiPayloadSchema = z.strictObject({
  cwd: absolutePathSchema.max(4096),
  resume: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,200}$/)
    .optional(),
  args: z.array(z.string().max(4096)).max(64).optional(),
});
export type TerminalGuiPayload = z.infer<typeof terminalGuiPayloadSchema>;
