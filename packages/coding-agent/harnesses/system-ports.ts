// 감지가 쓰는 실제 파일·process 눈이다. probe는 argv만 쓰고 shell을 열지 않으며 timeout과 출력 상한이 있다.
// 권한이 없거나 읽지 못한 것은 부재나 성공이 아니라 오류로 돌려 감지가 unknown으로 남게 한다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { ProbeOutput } from "./detect.ts";

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_OUTPUT_LIMIT_BYTES = 65_536;

export function executableOf(path: string): Result<boolean | null> {
  try {
    const info = Deno.statSync(path);
    if (!info.isFile) return ok(null);
    return ok(info.mode !== null && (info.mode & 0o111) !== 0);
  } catch (thrown) {
    if (
      thrown instanceof Deno.errors.NotFound ||
      (thrown instanceof Error &&
        /ENOTDIR|Not a directory/.test(thrown.message))
    ) return ok(null);
    return err({ code: "unavailable", message: "파일을 읽지 못했다" });
  }
}

async function readLimited(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 이미 닫힌 stream이다.
    }
  }
  const joined = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const room = joined.length - offset;
    if (room <= 0) break;
    joined.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.length, room);
  }
  return new TextDecoder().decode(joined);
}

export async function runProbe(
  argv: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<Result<ProbeOutput>> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(argv[0], {
      args: argv.slice(1),
      env: { ...env },
      clearEnv: true,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch {
    return err({
      code: "unavailable",
      message: "probe를 실행하지 못했다(실행 권한 또는 파일)",
    });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), PROBE_TIMEOUT_MS);
  });
  const finished = (async () => {
    const [stdout, stderr, status] = await Promise.all([
      readLimited(child.stdout, PROBE_OUTPUT_LIMIT_BYTES),
      readLimited(child.stderr, PROBE_OUTPUT_LIMIT_BYTES),
      child.status,
    ]);
    return { exit: status.code, text: `${stdout}\n${stderr}` };
  })();
  const raced = await Promise.race([finished, timedOut]);
  clearTimeout(timer);
  if (raced === "timeout") {
    try {
      child.kill("SIGKILL");
    } catch {
      // 이미 끝났다.
    }
    return ok({ exit: null, text: "" });
  }
  return ok(raced);
}
