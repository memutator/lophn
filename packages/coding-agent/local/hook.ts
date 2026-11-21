// `lophn hook <harness> <event>`: harness hook이 부르는 명령이다. stdin JSON을 터미널의 hook socket(shell main)에
// 한 줄로 쓴다. core는 부르지 않는다. 전역 hook이라 lophn과 상관없는 harness 실행에서도 불린다.
// `LPN_TERMINAL_HOOK`이 없으면 stdin도 읽지 않고 성공한다. hook은 사용자의 harness 안에서 동기로 돌므로
// 어떤 실패도 내지 않는다. stdout은 harness가 요구하는 것(`hookStdout`)만 쓰고 나머지는 비운다(harness가 model context로
// 읽을 수 있다). launcher가 env 없이 일찍 끝날 때도 같은 표를 쓴다.
import { connect, type Socket } from "node:net";
import { err, ok, type Result } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import {
  type HarnessId,
  harnessIdSchema,
  HOOK_EVENT_MAX_CHARS,
  HOOK_PAYLOAD_MAX_BYTES,
  HOOK_STDIN_MAX_BYTES,
  HOOK_TEXT_FIELD_MAX_CHARS,
  hookStdout,
  parseGuiLaunchArgs,
  TERMINAL_GUI_EVENT,
  TERMINAL_HOOK_ENV,
  terminalHookEnvSchema,
  terminalHookLineSchema,
} from "../../protocol/coding-agent/mod.ts";
import { z } from "zod";
import type { LocalCommand, LocalContext } from "./types.ts";

// 느린 shell main이나 닫히지 않는 stdin이 harness를 붙잡지 않게 한다. stdin 읽기와 socket 쓰기가 이 하나를 나눠 쓴다.
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

// Node `connect({ path })`는 POSIX unix socket과 Windows named pipe를 같은 API로 연다.
function connectSocket(path: string): Promise<Socket> {
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

async function writeLine(
  path: string,
  line: string,
  deadlineMs: number,
): Promise<void> {
  let socket: Socket | undefined;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (async () => {
    const connected = await connectSocket(path);
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
        timer = setTimeout(resolve, deadlineMs);
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
  const startedAt = Date.parse(ctx.now());
  // `--gui` shell 함수는 `--` 뒤에 CLI 인자들을 그대로 넘긴다. 잘못된 resume id는 바로 알려 준다.
  let guiExtra: { resume?: string; args: string[] } | undefined;
  if (
    input.event === TERMINAL_GUI_EVENT &&
    ctx.extraArgs !== undefined &&
    ctx.extraArgs.length > 0
  ) {
    const parsedArgs = parseGuiLaunchArgs(
      input.harness as HarnessId,
      ctx.extraArgs,
    );
    if (!parsedArgs.ok) {
      return err({ code: "invalid_input", message: parsedArgs.message });
    }
    guiExtra = parsedArgs;
  }
  try {
    let parsed: unknown = {};
    if (guiExtra === undefined) {
      // 기한 뒤 매달린 읽기는 그대로 둔다. cliMain이 끝에서 process.exit하므로 process를 붙잡지 않는다.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const text = await Promise.race([
        ctx.stdin(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), HOOK_DEADLINE_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      if (text === null) return ok(stdout);
      // 읽다 만 JSON은 못 읽는다.
      if (new TextEncoder().encode(text).length > HOOK_STDIN_MAX_BYTES) {
        return ok(stdout);
      }
      // PowerShell은 `$OutputEncoding`이 BOM 있는 UTF-8이면 native 명령에 파이프로 넘긴 글 앞에 BOM을 붙인다.
      // 그대로 두면 GUI 요청이 JSON parse에서 조용히 버려진다.
      const body = text.replace(/^﻿/, "");
      parsed = shortened(body.trim() === "" ? {} : JSON.parse(body));
    }
    // main은 shell이 `cd`한 뒤의 폴더를 모르므로 gui 요청에는 이 함수를 친 폴더를 더한다.
    const payload =
      input.event === TERMINAL_GUI_EVENT
        ? {
            ...(parsed as object),
            cwd: ctx.cwd,
            ...(guiExtra?.resume === undefined
              ? {}
              : { resume: guiExtra.resume }),
            ...(guiExtra !== undefined && guiExtra.args.length > 0
              ? { args: guiExtra.args }
              : {}),
          }
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
      await writeLine(
        target.socket,
        JSON.stringify(line.data),
        Math.max(0, HOOK_DEADLINE_MS - (Date.parse(ctx.now()) - startedAt)),
      );
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
