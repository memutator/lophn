// `lophn harness detect|refresh|install`의 실행이다. 감지·설치 engine을 부르는 일만 하고 새 규칙은 없다.
// `install`은 home 기준 전역 위치에 쓴다.
// `detect`는 실행 파일만 찾고 `refresh`는 version probe까지 돈다. 결과는 저장하지 않는다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import type {
  HarnessDetection,
  HarnessId,
} from "../../../protocol/coding-agent/mod.ts";
import {
  detectHarnesses,
  executableOf,
  installGlobal,
  runProbe,
} from "../../harnesses/mod.ts";
import type { LocalEnv } from "./types.ts";

export function runHarnessDetect(
  mode: "detect" | "refresh",
  local: LocalEnv,
): Promise<Result<HarnessDetection[], LophnError>> {
  const probeEnv: Record<string, string> = {};
  for (const name of ["PATH", "HOME"]) {
    const value = local.env.get(name);
    if (value !== undefined) probeEnv[name] = value;
  }
  return detectHarnesses(
    {
      executable: executableOf,
      run: (argv) => runProbe(argv, probeEnv),
      path: local.env.get("PATH"),
      home: local.home,
    },
    { probe: mode === "refresh", now: local.now() },
  );
}

// harness의 전역 위치에 hook 설정을 놓고 지운 skill의 옛 사본을 지운다. `dry_run`이면 쓰지도 지우지도 않고 할 일이 있는지만 본다.
export async function runHarnessInstall(
  input: { harness: HarnessId; dry_run?: boolean; command?: string },
  home: string,
  now: string,
): Promise<
  Result<{ skill: string; hook: string; files: string[] }, LophnError>
> {
  const done = await installGlobal(
    {
      async read(path) {
        try {
          return await Deno.readTextFile(path);
        } catch (thrown) {
          if (thrown instanceof Deno.errors.NotFound) return null;
          throw thrown;
        }
      },
      async write(path, text, executable) {
        // 폴더가 이미 있으면 file 하나의 권한만으로 쓴다(폴더째 권한을 열지 않는 harness가 있다).
        try {
          await Deno.writeTextFile(path, text);
        } catch (thrown) {
          if (!(thrown instanceof Deno.errors.NotFound)) throw thrown;
          await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
            recursive: true,
          });
          await Deno.writeTextFile(path, text);
        }
        if (executable === true) await Deno.chmod(path, 0o755);
      },
      async list(dir) {
        try {
          const names: string[] = [];
          for await (const entry of Deno.readDir(dir)) names.push(entry.name);
          return names;
        } catch (thrown) {
          if (thrown instanceof Deno.errors.NotFound) return null;
          throw thrown;
        }
      },
      // 옵션이 없어 비지 않은 폴더는 던진다. 사람의 다른 file을 지울 길이 없다.
      remove: (path) => Deno.remove(path),
    },
    {
      harness: input.harness,
      home,
      dryRun: input.dry_run === true,
      command: input.command,
      now,
    },
  );
  return done.ok ? ok(done.value) : err(done.error);
}
