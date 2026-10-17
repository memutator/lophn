// `lophn harness detect|refresh|install`의 실행이다. 감지·설치 engine을 부르는 일만 하고 새 규칙은 없다.
// `install`은 home 기준 전역 위치에 쓴다(권한도 그 harness의 두 위치만 연다).
// `detect`는 실행 파일만 찾고 `refresh`는 version·login probe까지 돈다. 결과는 저장하지 않는다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  HARNESS_ADAPTERS,
  type HarnessDetection,
  type HarnessId,
} from "../../../protocol/coding-agent/mod.ts";
import { loadSkills } from "../../guides/mod.ts";
import {
  detectHarnesses,
  discover,
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

// harness의 전역 위치에 skill 둘과 hook 설정을 놓는다. `dry_run`이면 쓰지 않고 놓을 것이 있는지만 본다.
export async function runHarnessInstall(
  input: { harness: HarnessId; dry_run?: boolean; command?: string },
  home: string,
): Promise<
  Result<{ skill: string; hook: string; files: string[] }, LophnError>
> {
  const skills = await loadSkills();
  if (!skills.ok) return skills;
  const done = await installGlobal(
    {
      skills: skills.value,
      async read(path) {
        try {
          return await Deno.readTextFile(path);
        } catch (thrown) {
          if (thrown instanceof Deno.errors.NotFound) return null;
          throw thrown;
        }
      },
      async write(path, text) {
        await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
          recursive: true,
        });
        await Deno.writeTextFile(path, text);
      },
    },
    {
      harness: input.harness,
      home,
      dryRun: input.dry_run === true,
      command: input.command,
    },
  );
  return done.ok ? ok(done.value) : err(done.error);
}

// `harness refresh`가 probe를 돌릴 제품 실행 파일의 절대 경로들이다(probe는 돌리지 않는다). launcher가
// 이 파일에만 실행 권한을 연다.
export function detectedExecutables(
  env: { get(name: string): string | undefined },
  home: string,
): string[] {
  const found: string[] = [];
  for (const adapter of Object.values(HARNESS_ADAPTERS)) {
    const { selected } = discover(adapter, {
      executable: executableOf,
      path: env.get("PATH"),
      home,
    });
    if (selected !== null) found.push(selected);
  }
  return [...new Set(found)];
}

// 감지가 PATH 말고 읽는 home 기준 폴더들이다(읽기 권한 계산에 쓴다).
