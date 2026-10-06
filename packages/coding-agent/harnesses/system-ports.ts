// 감지가 쓰는 실제 파일·process 눈이다(coding-agent/harnesses#R2, R3, R12). 감지는 PATH와
// catalog의 fallback 디렉터리만 읽고(detection.ts), probe는 argv만 쓰고 shell을 열지 않으며
// timeout·출력 상한이 있다. 권한이 없거나 읽지 못한 것은 부재나 성공이 아니라 오류로 돌려
// 감지가 unknown으로 남게 한다(R3). probe 출력 원문은 반환하지 않고 classifier가 다듬은 안전
// detail만 낸다(R12).
import { err, ok } from "../../base/mod.ts";
import {
  type ExecPort,
  type FilesPort,
  PROBE_OUTPUT_LIMIT_BYTES,
  PROBE_TIMEOUT_MS,
  type ProbeRun,
} from "./detection.ts";
import type { ProbeSpec } from "./model.ts";

export function systemFilesPort(): FilesPort {
  return {
    list(dir) {
      try {
        const names: string[] = [];
        for (const entry of Deno.readDirSync(dir)) names.push(entry.name);
        return ok(names);
      } catch (thrown) {
        if (
          thrown instanceof Deno.errors.NotFound ||
          (thrown instanceof Error &&
            /ENOTDIR|Not a directory/.test(thrown.message))
        ) return ok(null);
        return err({ code: "unavailable", message: "디렉터리를 읽지 못했다" });
      }
    },
    executable(path) {
      try {
        const info = Deno.statSync(path);
        if (!info.isFile) return ok(null);
        return ok(info.mode !== null && (info.mode & 0o111) !== 0);
      } catch (thrown) {
        if (thrown instanceof Deno.errors.NotFound) return ok(null);
        return err({ code: "unavailable", message: "파일을 읽지 못했다" });
      }
    },
  };
}

const SEMVER = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/;

// stdout·stderr 원문을 다듬은 안전 detail로 줄인다. 원문 문장은 남기지 않는다.
export function classifyProbe(
  classifier: ProbeSpec["classifier"],
  exitCode: number,
  output: string,
): ProbeRun {
  if (classifier === "first_semver") {
    const first = output.split("\n").find((line) => line.trim() !== "") ?? "";
    const found = SEMVER.exec(first);
    if (exitCode === 0 && found !== null) {
      return { outcome: "ok", detail: found[1] };
    }
    return {
      outcome: "failed",
      detail: exitCode === 0
        ? "version 문구를 읽지 못했다"
        : `version 확인이 종료 ${exitCode}로 끝났다`,
    };
  }
  if (exitCode === 0) return { outcome: "ok", detail: "verified" };
  if (/not logged in|no credentials|logged out/i.test(output)) {
    return { outcome: "ok", detail: "not_verified" };
  }
  return {
    outcome: "failed",
    detail: `인증 확인이 종료 ${exitCode}로 끝났다`,
  };
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
    const part = chunk.subarray(0, room);
    joined.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(joined);
}

// probe 하나를 실행한다. classifier는 spec이 정한다(argv만 받는 ExecPort 모양이라 만들 때 받는다).
export function systemExecPort(
  classifier: ProbeSpec["classifier"],
  env: Readonly<Record<string, string>> = {},
): ExecPort {
  return {
    async run(argv, limit) {
      const timeout = Math.min(limit.timeout_ms, PROBE_TIMEOUT_MS);
      const cap = Math.min(limit.output_limit_bytes, PROBE_OUTPUT_LIMIT_BYTES);
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
        timer = setTimeout(() => resolve("timeout"), timeout);
      });
      const finished = (async () => {
        const [stdout, stderr, status] = await Promise.all([
          readLimited(child.stdout, cap),
          readLimited(child.stderr, cap),
          child.status,
        ]);
        return { text: `${stdout}\n${stderr}`, code: status.code };
      })();
      const raced = await Promise.race([finished, timedOut]);
      clearTimeout(timer);
      if (raced === "timeout") {
        try {
          child.kill("SIGKILL");
        } catch {
          // 이미 끝났다.
        }
        return ok({ outcome: "timeout", detail: "시간 안에 끝나지 않았다" });
      }
      return ok(classifyProbe(classifier, raced.code, raced.text));
    },
  };
}
