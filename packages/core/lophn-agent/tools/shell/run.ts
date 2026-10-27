import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { constants } from "node:os";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
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

// 가능하면 setsid로 새 process group을 만들어 시간 초과 때 자식들까지 함께 죽인다.
const LAUNCH =
  'if command -v setsid >/dev/null 2>&1; then exec setsid /bin/sh -c "$1"; else exec /bin/sh -c "$1"; fi';

type Collected = { text: string; truncated: boolean };

function concat(
  a: Uint8Array,
  b: Uint8Array,
): Uint8Array<ArrayBuffer> {
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
    if (b >= 0xC0) {
      const need = b >= 0xF0 ? 4 : b >= 0xE0 ? 3 : 2;
      return i + need > bytes.length ? bytes.slice(0, i) : bytes;
    }
  }
  return bytes;
}

function trimPartialStart(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < 3 && i < bytes.length && (bytes[i]! & 0xC0) === 0x80) i++;
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
  const headPart = limitText(
    decoder.decode(trimPartialEnd(head)),
    "head",
  );
  const tailPart = limitText(
    decoder.decode(trimPartialStart(tail)),
    "tail",
  );
  const encoder = new TextEncoder();
  const omitted = total - encoder.encode(headPart.text).length -
    encoder.encode(tailPart.text).length;
  return {
    text:
      `${headPart.text}\n[… ${omitted} bytes omitted; redirect output to a file and read it with file.read …]\n${tailPart.text}`,
    truncated: true,
  };
}

function killGroup(pid: number): void {
  try {
    spawnSync("/bin/sh", ["-c", `kill -KILL -- -${pid} 2>/dev/null`], {
      stdio: "ignore",
      env: {},
    });
  } catch {
    // group이 없으면 아래 child.kill이 sh 하나를 죽인다.
  }
}

export async function runShell(
  input: { command: string; timeout_ms?: number },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  const cwd = ctx.scope.base ?? ctx.scope.read[0];
  if (cwd === undefined) {
    return fail("invalid_input", "this place has no folder to run in");
  }
  const timeoutMs = Math.min(
    input.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );

  let child: ChildProcess;
  try {
    child = spawn("/bin/sh", ["-c", LAUNCH, "sh", input.command], {
      cwd,
      env: readShellEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
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
  const pid = child.pid;
  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => {
      // 신호로 끝나면 shell 관례대로 128 + 신호 번호를 쓴다. Node는 그때 code가 null이다.
      resolve(signal === null ? code ?? 0 : 128 + constants.signals[signal]);
    });
  });

  const kill = () => {
    killGroup(pid);
    try {
      child.kill("SIGKILL");
    } catch {
      // 이미 끝났다.
    }
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  // 사람이 turn을 멈추면 group을 죽인다. 안 그러면 명령이 멈춘 뒤에도 돈다.
  if (ctx.signal?.aborted) kill();
  else ctx.signal?.addEventListener("abort", kill, { once: true });

  const out = collect(child.stdout!);
  const errOut = collect(child.stderr!);
  const code = await exited;
  clearTimeout(timer);
  ctx.signal?.removeEventListener("abort", kill);
  const empty: Collected = { text: "", truncated: false };
  const grace = <T>(promise: Promise<T>, fallback: T) =>
    Promise.race([
      promise,
      new Promise<T>((resolve) =>
        setTimeout(() => resolve(fallback), DRAIN_GRACE_MS)
      ),
    ]);
  const [stdout, stderr] = await Promise.all([
    grace(out, empty),
    grace(errOut, empty),
  ]);

  const content = {
    exit_code: timedOut ? null : code,
    timed_out: timedOut,
    stdout: stdout.text,
    stderr: stderr.text,
    stdout_truncated: stdout.truncated,
    stderr_truncated: stderr.truncated,
  };
  const truncated = stdout.truncated || stderr.truncated;
  return ok({
    status: timedOut ? "failure" : "success",
    summary: timedOut ? `timed out after ${timeoutMs} ms` : `exit code ${code}`,
    content,
    complete: !truncated && !timedOut,
    source: null,
    continuation: null,
    pending: [],
  });
}
