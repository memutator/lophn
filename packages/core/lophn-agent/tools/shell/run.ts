import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { fail } from "../file/scope.ts";
import type { ToolContext } from "../tool-context.ts";
import { readShellEnvironment } from "./env.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const OUTPUT_MAX_BYTES = 1024 * 1024;
// 시간이 지나 group을 죽인 뒤 출력 pipe가 닫히기를 기다리는 최대 시간이다.
const DRAIN_GRACE_MS = 1_000;

// 가능하면 setsid로 새 process group을 만들어 시간 초과 때 자식들까지 함께 죽인다.
const LAUNCH =
  'if command -v setsid >/dev/null 2>&1; then exec setsid /bin/sh -c "$1"; else exec /bin/sh -c "$1"; fi';

type Collected = { text: string; truncated: boolean };

async function collect(stream: ReadableStream<Uint8Array>): Promise<Collected> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    if (size >= OUTPUT_MAX_BYTES) {
      truncated = true;
      continue;
    }
    const room = OUTPUT_MAX_BYTES - size;
    if (chunk.length > room) truncated = true;
    const kept = chunk.length > room ? chunk.slice(0, room) : chunk;
    chunks.push(kept);
    size += kept.length;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { text: new TextDecoder("utf-8").decode(bytes), truncated };
}

async function killGroup(pid: number): Promise<void> {
  try {
    await new Deno.Command("/bin/sh", {
      args: ["-c", `kill -KILL -- -${pid} 2>/dev/null`],
      clearEnv: true,
      stdout: "null",
      stderr: "null",
    }).output();
  } catch {
    // group이 없으면 아래 child.kill이 sh 하나를 죽인다.
  }
}

export async function runShell(
  input: { command: string; timeout_ms?: number },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  const cwd = ctx.scope.read[0];
  if (cwd === undefined) {
    return fail("invalid_input", "this place has no folder to run in");
  }
  const timeoutMs = Math.min(
    input.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );

  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("/bin/sh", {
      args: ["-c", LAUNCH, "sh", input.command],
      cwd,
      clearEnv: true,
      env: readShellEnvironment(),
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch {
    return fail("unavailable", "cannot start the shell");
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void killGroup(child.pid).then(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // 이미 끝났다.
      }
    });
  }, timeoutMs);

  const out = collect(child.stdout);
  const errOut = collect(child.stderr);
  const status = await child.status;
  clearTimeout(timer);
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
    exit_code: timedOut ? null : status.code,
    timed_out: timedOut,
    stdout: stdout.text,
    stderr: stderr.text,
    stdout_truncated: stdout.truncated,
    stderr_truncated: stderr.truncated,
  };
  const truncated = stdout.truncated || stderr.truncated;
  return ok({
    status: timedOut ? "failure" : "success",
    summary: timedOut
      ? `timed out after ${timeoutMs} ms`
      : `exit code ${status.code}`,
    content,
    complete: !truncated && !timedOut,
    source: null,
    continuation: null,
    pending: [],
  });
}
