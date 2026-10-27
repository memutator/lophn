// 감지가 쓰는 실제 파일·process 눈이다. probe는 argv만 쓰고 shell을 열지 않으며 timeout과 출력 상한이 있다.
// 권한이 없거나 읽지 못한 것은 부재나 성공이 아니라 오류로 돌려 감지가 unknown으로 남게 한다.
import { Buffer } from "node:buffer";
import { type ChildProcess, spawn } from "node:child_process";
import { statSync } from "node:fs";
import type { Readable } from "node:stream";
import { err, errorCode, ok, type Result } from "../../base/mod.ts";
import type { ProbeOutput } from "./detect.ts";

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_OUTPUT_LIMIT_BYTES = 65_536;

export function executableOf(path: string): Result<boolean | null> {
  try {
    const info = statSync(path);
    if (!info.isFile()) return ok(null);
    return ok((info.mode & 0o111) !== 0);
  } catch (thrown) {
    const code = errorCode(thrown);
    if (code === "ENOENT" || code === "ENOTDIR") return ok(null);
    return err({ code: "unavailable", message: "파일을 읽지 못했다" });
  }
}

// 상한까지만 모은다. 넘으면 더 받지 않고, 읽는 쪽은 child가 끝난 뒤에 text를 부른다.
function collectLimited(stream: Readable, limit: number): () => string {
  const chunks: Buffer[] = [];
  let size = 0;
  stream.on("data", (chunk: Buffer) => {
    if (size >= limit) return;
    chunks.push(chunk);
    size += chunk.length;
    if (size >= limit) stream.pause();
  });
  return () => {
    const joined = Buffer.concat(chunks).subarray(0, Math.min(size, limit));
    return joined.toString("utf8");
  };
}

export async function runProbe(
  argv: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<Result<ProbeOutput>> {
  let child: ChildProcess;
  try {
    child = spawn(argv[0], argv.slice(1), {
      // env만 넘긴다. Node는 부모 환경을 물려주지 않고 이 값으로 바꾼다(Deno의 clearEnv와 같다).
      env: { ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return err({
      code: "unavailable",
      message: "probe를 실행하지 못했다(실행 권한 또는 파일)",
    });
  }
  const stdout = collectLimited(child.stdout!, PROBE_OUTPUT_LIMIT_BYTES);
  const stderr = collectLimited(child.stderr!, PROBE_OUTPUT_LIMIT_BYTES);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), PROBE_TIMEOUT_MS);
  });
  const finished = new Promise<Result<ProbeOutput>>((resolve) => {
    // 실행 파일이 없거나 권한이 없으면 Node는 여기로 온다(Deno는 spawn이 던졌다).
    child.on("error", () => {
      resolve(err({
        code: "unavailable",
        message: "probe를 실행하지 못했다(실행 권한 또는 파일)",
      }));
    });
    child.on("close", (code) => {
      resolve(ok({ exit: code, text: `${stdout()}\n${stderr()}` }));
    });
  });
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
  return raced;
}
