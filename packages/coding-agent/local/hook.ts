// `lophn hook <harness> <event>`: harness hook이 부르는 명령이다. stdin JSON을 터미널의 hook socket(shell main)에
// 한 줄로 쓴다. core는 부르지 않는다. 전역 hook이라 lophn과 상관없는 harness 실행에서도 불린다.
// `LPN_TERMINAL_HOOK`이 없으면 stdin도 읽지 않고 성공한다. hook은 사용자의 harness 안에서 동기로 돌므로
// 어떤 실패도 내지 않는다. stdout은 harness가 요구하는 것(`hookStdout`)만 쓰고 나머지는 비운다(harness가 model context로
// 읽을 수 있다). launcher가 env 없이 일찍 끝날 때도 같은 표를 쓴다.
import { connect, type Socket } from "node:net";
import { ok, type Result } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import {
  harnessIdSchema,
  HOOK_EVENT_MAX_CHARS,
  HOOK_PAYLOAD_MAX_BYTES,
  HOOK_STDIN_MAX_BYTES,
  HOOK_TEXT_FIELD_MAX_CHARS,
  hookStdout,
  TERMINAL_GUI_EVENT,
  TERMINAL_HOOK_ENV,
  terminalHookEnvSchema,
  terminalHookLineSchema,
} from "../../protocol/coding-agent/mod.ts";
import { z } from "zod";
import type { LocalCommand, LocalContext } from "./types.ts";

// 느린 shell main이 harness를 붙잡지 않게 한다.
const HOOK_DEADLINE_MS = 1_000;

function terminalHookOf(env: LocalContext["env"]) {
  const raw = env.get(TERMINAL_HOOK_ENV);
  if (raw === undefined || raw === "") return null;
  try {
    const parsed = terminalHookEnvSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function connectUnix(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path });
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      // 처리하지 않은 'error' event는 process를 죽인다. 연결 뒤의 실패는 보낸 것으로 친다.
      socket.on("error", () => {});
      resolve(socket);
    });
  });
}

async function writeLine(path: string, line: string): Promise<void> {
  let socket: Socket | undefined;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (async () => {
    const connected = await connectUnix(path);
    if (done) {
      connected.destroy();
      return;
    }
    socket = connected;
    await new Promise<void>((resolve, reject) => {
      connected.write(`${line}\n`, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  })().catch(() => {});
  try {
    await Promise.race([
      send,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, HOOK_DEADLINE_MS);
      }),
    ]);
  } finally {
    done = true;
    clearTimeout(timer);
    socket?.destroy();
  }
}

// 긴 마지막 답 하나가 turn 끝 신호째 버려지면 안 되어 최상위 글 field만 자른다.
function shortened(payload: unknown): unknown {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return payload;
  }
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      typeof value === "string"
        ? value.slice(0, HOOK_TEXT_FIELD_MAX_CHARS)
        : value,
    ]),
  );
}

async function runHook(
  input: Record<string, unknown>,
  ctx: LocalContext,
): Promise<Result<unknown, LophnError>> {
  const stdout =
    hookStdout(String(input.harness), String(input.event)) ?? undefined;
  const target = terminalHookOf(ctx.env);
  if (target === null) return ok(stdout);
  try {
    const text = await ctx.stdin();
    // 읽다 만 JSON은 못 읽는다.
    if (new TextEncoder().encode(text).length > HOOK_STDIN_MAX_BYTES) {
      return ok(stdout);
    }
    const parsed = shortened(text.trim() === "" ? {} : JSON.parse(text));
    // main은 shell이 `cd`한 뒤의 폴더를 모르므로 gui 요청에는 이 함수를 친 폴더를 더한다.
    const payload =
      input.event === TERMINAL_GUI_EVENT
        ? { ...(parsed as object), cwd: ctx.cwd }
        : parsed;
    if (
      new TextEncoder().encode(JSON.stringify(payload)).length >
      HOOK_PAYLOAD_MAX_BYTES
    )
      return ok(stdout);
    const line = terminalHookLineSchema.safeParse({
      v: 1,
      key: target.key,
      harness: input.harness,
      event: input.event,
      payload,
    });
    if (line.success) {
      await writeLine(target.socket, JSON.stringify(line.data));
    }
  } catch {
    // payload가 JSON이 아니거나 socket이 없다. hook 실패가 harness를 멈추게 하지 않는다.
  }
  return ok(stdout);
}

export const HOOK_COMMANDS: readonly LocalCommand[] = [
  {
    name: "hook",
    summary: "Forward a harness hook event to the terminal hook socket",
    description:
      "Called by a harness hook with the event payload as JSON on stdin. Writes one line to the terminal's hook socket and never calls core. Does nothing when LPN_TERMINAL_HOOK is not set.",
    input: z.strictObject({
      harness: harnessIdSchema,
      event: z.string().min(1).max(HOOK_EVENT_MAX_CHARS),
    }),
    positional: ["harness", "event"],
    effect: "write",
    run: runHook,
  },
];
