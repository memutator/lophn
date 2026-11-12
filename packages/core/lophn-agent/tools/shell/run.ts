import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { win32 } from "node:path";
import process from "node:process";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { envValue } from "../../../supervision/security/child-env.ts";
import {
  killTree,
  treeSpawnOptions,
} from "../../../supervision/security/tree-kill.ts";
import { fail } from "../file/scope.ts";
import { limitText } from "../result.ts";
import type { ToolContext } from "../tool-context.ts";
import { readShellEnvironment } from "./env.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const HEAD_BYTES = 12 * 1024;
const TAIL_BYTES = 12 * 1024;
// 시간이 지나 group을 죽인 뒤 출력 pipe가 닫히기를 기다리는 최대 시간이다.
const DRAIN_GRACE_MS = 1_000;

const GIT_BASH_MISSING =
  "the shell tool on Windows needs Git for Windows (bash). Install it or set LOPHN_GIT_BASH to the path of bash.exe";

export type ShellDeps = {
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
  exists(path: string): boolean;
  spawn: typeof spawn;
  // process가 끝날 때 동기로 부를 hook을 건다. 돌려준 함수가 푼다.
  onExit(hook: () => void): () => void;
};

// Windows의 shell tool은 Git for Windows의 bash로 돈다. 환경 변수 → 흔한 설치 자리 순이다.
export function findGitBash(
  env: ShellDeps["env"],
  exists: ShellDeps["exists"],
): string | undefined {
  const named = envValue(env, "LOPHN_GIT_BASH", "win32");
  if (named) return named;
  const roots = [
    envValue(env, "ProgramFiles", "win32"),
    envValue(env, "ProgramFiles(x86)", "win32"),
    envValue(env, "LOCALAPPDATA", "win32"),
  ];
  const suffix = ["Git", "bin", "bash.exe"];
  const candidates = [
    roots[0] && win32.join(roots[0], ...suffix),
    roots[1] && win32.join(roots[1], ...suffix),
    roots[2] && win32.join(roots[2], "Programs", ...suffix),
  ];
  return candidates.find((path) => path && exists(path)) || undefined;
}

type Collected = { text: string; truncated: boolean };

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// 자른 자리가 멀티바이트 문자 한가운데면 그 조각을 버려 교체 문자(U+FFFD)가 안 생기게 한다.
function trimPartialEnd(bytes: Uint8Array): Uint8Array {
  for (let i = bytes.length - 1; i >= Math.max(0, bytes.length - 4); i--) {
    const b = bytes[i]!;
    if (b < 0x80) return bytes;
    if (b >= 0xc0) {
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      return i + need > bytes.length ? bytes.slice(0, i) : bytes;
    }
  }
  return bytes;
}

function trimPartialStart(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < 3 && i < bytes.length && (bytes[i]! & 0xc0) === 0x80) i++;
  return bytes.slice(i);
}

// 오류는 끝에 나오므로 앞 HEAD_BYTES와 굴러가는 뒤 TAIL_BYTES만 쥐고 가운데는 버린다.
export async function collect(
  stream: AsyncIterable<Uint8Array>,
): Promise<Collected> {
  let head: Uint8Array = new Uint8Array(0);
  let tail: Uint8Array = new Uint8Array(0);
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (head.length < HEAD_BYTES) {
      head = concat(head, chunk.subarray(0, HEAD_BYTES - head.length));
    }
    tail = concat(tail, chunk);
    if (tail.length > TAIL_BYTES) tail = tail.slice(tail.length - TAIL_BYTES);
  }
  const decoder = new TextDecoder("utf-8");
  if (total <= HEAD_BYTES + TAIL_BYTES) {
    const rest = tail.slice(tail.length - (total - head.length));
    return { text: decoder.decode(concat(head, rest)), truncated: false };
  }
  const headPart = limitText(decoder.decode(trimPartialEnd(head)), "head");
  const tailPart = limitText(decoder.decode(trimPartialStart(tail)), "tail");
  const encoder = new TextEncoder();
  const omitted =
    total -
    encoder.encode(headPart.text).length -
    encoder.encode(tailPart.text).length;
  return {
    text: `${headPart.text}\n[… ${omitted} bytes omitted; redirect output to a file and read it with file.read …]\n${tailPart.text}`,
    truncated: true,
  };
}

export type CommandRun = {
  // 시간이 지났거나 멈춘 명령은 성공도 실패도 아니라 null이다.
  exit_code: number | null;
  timed_out: boolean;
  stopped: boolean;
  stdout: string;
  stderr: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
};

function processShellDeps(): ShellDeps {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    spawn,
    onExit(hook) {
      process.on("exit", hook);
      return () => process.off("exit", hook);
    },
  };
}

// agent의 `shell.run`과 사람의 `!`가 함께 쓰는 실행부다. 승인과 cwd 고르기는 부르는 쪽 몫이다.
export async function runCommand(
  input: {
    command: string;
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
  },
  deps: ShellDeps = processShellDeps(),
): Promise<Result<CommandRun>> {
  const bash =
    deps.platform === "win32" ? findGitBash(deps.env, deps.exists) : undefined;
  if (deps.platform === "win32" && bash === undefined) {
    return fail("unavailable", GIT_BASH_MISSING);
  }
  let child: ChildProcess;
  try {
    // POSIX는 detached가 새 session이라 시간 초과 때 자식들까지 group째 죽는다. Windows는 taskkill이 트리를 끈다.
    child = deps.spawn(bash ?? "/bin/sh", ["-c", input.command], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...treeSpawnOptions(deps.platform),
    });
  } catch {
    return fail("unavailable", "cannot start the shell");
  }
  // 'error'를 듣지 않으면 spawn·kill 실패가 process를 죽인다.
  child.on("error", () => {});
  // spawn 실패는 pid 없이 돌아오므로 여기서 unavailable로 끝낸다.
  if (child.pid === undefined) {
    return fail("unavailable", "cannot start the shell");
  }
  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => {
      // 신호로 끝나면 shell 관례대로 128 + 신호 번호를 쓴다. Node는 그때 code가 null이다.
      resolve(signal === null ? (code ?? 0) : 128 + constants.signals[signal]);
    });
  });

  const kill = () => killTree(child, deps.platform);
  // 이 process가 먼저 끝나면(crash, 감독의 SIGKILL, 정상 정지) 자식 group이 남지 않게 죽인다. 자식이 끝나면 푼다: 끝난 group 번호를 쥐고 있으면 재사용된 번호를 죽일 수 있다.
  const offExit = deps.onExit(kill);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, input.timeoutMs);
  // 사람이 turn을 멈추면 group을 죽인다. 안 그러면 명령이 멈춘 뒤에도 돈다. 죽인 명령은 성공이 아니다.
  let stopped = false;
  const stop = () => {
    stopped = true;
    kill();
  };
  if (input.signal?.aborted) stop();
  else input.signal?.addEventListener("abort", stop, { once: true });

  const out = collect(child.stdout!);
  const errOut = collect(child.stderr!);
  const code = await exited;
  clearTimeout(timer);
  offExit();
  input.signal?.removeEventListener("abort", stop);
  const empty: Collected = { text: "", truncated: false };
  const grace = <T>(promise: Promise<T>, fallback: T) =>
    Promise.race([
      promise,
      new Promise<T>((resolve) =>
        setTimeout(() => resolve(fallback), DRAIN_GRACE_MS),
      ),
    ]);
  const [stdout, stderr] = await Promise.all([
    grace(out, empty),
    grace(errOut, empty),
  ]);
  return ok({
    exit_code: timedOut || stopped ? null : code,
    timed_out: timedOut,
    stopped,
    stdout: stdout.text,
    stderr: stderr.text,
    stdout_truncated: stdout.truncated,
    stderr_truncated: stderr.truncated,
  });
}

export async function runShell(
  input: { command: string; timeout_ms?: number },
  ctx: ToolContext,
  deps: ShellDeps = processShellDeps(),
): Promise<Result<ToolResult>> {
  const cwd = ctx.scope.base ?? ctx.scope.read[0];
  if (cwd === undefined) {
    return fail("invalid_input", "this workspace has no folder to run in");
  }
  const timeoutMs = Math.min(
    input.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const ran = await runCommand(
    {
      command: input.command,
      cwd,
      env: readShellEnvironment(deps.env, deps.platform, ctx.session),
      timeoutMs,
      signal: ctx.signal,
    },
    deps,
  );
  if (!ran.ok) return ran;
  const { timed_out: timedOut, stopped, exit_code: code } = ran.value;
  const content = {
    exit_code: code,
    timed_out: timedOut,
    stdout: ran.value.stdout,
    stderr: ran.value.stderr,
    stdout_truncated: ran.value.stdout_truncated,
    stderr_truncated: ran.value.stderr_truncated,
  };
  const truncated = ran.value.stdout_truncated || ran.value.stderr_truncated;
  return ok({
    // 시간 초과로 죽인 명령은 효과가 났는지 모른다. 사람이 멈춘 것은 지금처럼 failure다.
    status: timedOut ? "uncertain" : stopped ? "failure" : "success",
    summary: timedOut
      ? `timed out after ${timeoutMs} ms and was killed; it may have already taken effect, check before running it again`
      : stopped
        ? "stopped before it finished"
        : `exit code ${code}`,
    content,
    complete: !truncated && !timedOut && !stopped,
    source: null,
    continuation: null,
    pending: [],
  });
}
