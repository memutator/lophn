// CLI `sdk add --apply`의 앱 source 파일 통로다(T22·T36, mcp#R23, cli#R30). 이 통로는 앱 source의
// `deno.json` 한 파일만 읽고 쓰고, 이어서 설치된 Deno 하나로 `deno.lock`을 다시 만든다. 일반 파일
// 쓰기·실행이 아니다: 실행 권한은 `--allow-write=<source>/deno.json,<source>/deno.lock`·
// `--allow-run=<설치 Deno>`의 정확한 경로이고(MCP에는 이 통로가 없다), 이 port는 그 밖의 파일 이름과
// 경로를 코드에서도 거절한다. 권한이 없거나 읽기·쓰기에 실패하면 성공으로 꾸미지 않고 unavailable이다.
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import type { SdkSourcePort } from "./sdk-ops.ts";

const CONFIG = "deno.json";

export type DenoRun = (
  executable: string,
  args: readonly string[],
  cwd: string,
) => Promise<{ code: number }>;

const runDeno: DenoRun = async (executable, args, cwd) => {
  const out = await new Deno.Command(executable, {
    args: [...args],
    cwd,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).output();
  return { code: out.code };
};

function onlyConfig(path: string): Result<void, LophnError> {
  const segments = path.split("/");
  return segments[segments.length - 1] === CONFIG &&
      !segments.includes("..")
    ? ok(undefined)
    : err({
      code: "invalid_input",
      message: "앱 source의 deno.json만 읽고 쓴다",
    });
}

export function createSdkSourcePort(
  options: { denoExecutable: string; run?: DenoRun },
): SdkSourcePort {
  const run = options.run ?? runDeno;
  return {
    async readText(path) {
      const checked = onlyConfig(path);
      if (!checked.ok) return checked;
      try {
        return ok(await Deno.readTextFile(path));
      } catch (thrown) {
        if (thrown instanceof Deno.errors.NotFound) return ok(undefined);
        return err({
          code: "unavailable",
          message: "앱 source의 deno.json을 읽지 못했다(읽기 권한 또는 파일)",
        });
      }
    },
    async writeText(path, text) {
      const checked = onlyConfig(path);
      if (!checked.ok) return checked;
      try {
        await Deno.writeTextFile(path, text);
        return ok(undefined);
      } catch {
        return err({
          code: "unavailable",
          message: "앱 source의 deno.json에 쓰지 못했다(쓰기 권한 또는 파일)",
        });
      }
    },
    async refreshLock(sourceDir) {
      try {
        const done = await run(
          options.denoExecutable,
          ["install", "--cached-only"],
          sourceDir,
        );
        return done.code === 0 ? ok(undefined) : err({
          code: "unavailable",
          message:
            "deno.lock을 다시 만들지 못했다(설치 Deno cache에 없는 의존성일 수 있다)",
        });
      } catch {
        return err({
          code: "unavailable",
          message: "deno.lock을 다시 만들지 못했다(실행 권한 또는 설치 Deno)",
        });
      }
    },
  };
}
