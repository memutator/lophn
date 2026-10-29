// `lophn harness detect|refresh|install|status|uninstall`의 실행이다. 감지·설치 engine을 부르는 일만 하고 새 규칙은 없다.
// `install`·`uninstall`은 home 기준 전역 위치에 쓴다.
// `detect`는 실행 파일만 찾고 `refresh`는 version probe까지 돈다. 결과는 저장하지 않는다.
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import {
  err,
  errorCode,
  type LophnError,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  type HarnessDetection,
  type HarnessId,
  HARNESS_IDS,
} from "../../../protocol/coding-agent/mod.ts";
import {
  detectHarnesses,
  executableOf,
  installGlobal,
  type InstallPorts,
  runProbe,
  uninstallGlobal,
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

const nodePorts: InstallPorts = {
  async read(path) {
    try {
      return await readFile(path, "utf8");
    } catch (thrown) {
      if (errorCode(thrown) === "ENOENT") return null;
      throw thrown;
    }
  },
  async write(path, text, executable) {
    // 폴더가 이미 있으면 file 하나의 권한만으로 쓴다(폴더째 권한을 열지 않는 harness가 있다).
    try {
      await writeFile(path, text);
    } catch (thrown) {
      if (errorCode(thrown) !== "ENOENT") throw thrown;
      await mkdir(path.slice(0, path.lastIndexOf("/")), {
        recursive: true,
      });
      await writeFile(path, text);
    }
    if (executable === true) await chmod(path, 0o755);
  },
  async list(dir) {
    try {
      const names: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        names.push(entry.name);
      }
      return names;
    } catch (thrown) {
      if (errorCode(thrown) === "ENOENT") return null;
      throw thrown;
    }
  },
  // 옵션이 없어 비지 않은 폴더는 던진다. 사람의 다른 file을 지울 길이 없다.
  // rmdir은 file에 ENOTDIR로 던지므로 그때만 rm으로 지운다.
  remove: async (path) => {
    try {
      await rmdir(path);
    } catch (thrown) {
      if (errorCode(thrown) !== "ENOTDIR") throw thrown;
      await rm(path);
    }
  },
};

type InstallView = { skill: string; hook: string; files: string[] };

// harness의 전역 위치에 hook 설정을 놓고 지운 skill의 옛 사본을 지운다. `dry_run`이면 쓰지도 지우지도 않고 할 일이 있는지만 본다.
export async function runHarnessInstall(
  input: { harness: HarnessId; dry_run?: boolean; command?: string },
  home: string,
  now: string,
): Promise<Result<InstallView, LophnError>> {
  const done = await installGlobal(nodePorts, {
    harness: input.harness,
    home,
    dryRun: input.dry_run === true,
    command: input.command,
    now,
  });
  return done.ok ? ok(done.value) : err(done.error);
}

// 모든 harness의 `install --dry_run`이다. 한 harness가 실패해도 나머지를 보이고 그 harness는 `failed`다.
export async function runHarnessStatus(
  input: { command?: string },
  home: string,
  now: string,
): Promise<Result<(InstallView & { harness: HarnessId })[], LophnError>> {
  const rows = await Promise.all(
    HARNESS_IDS.map(async (harness) => {
      const done = await runHarnessInstall(
        { harness, dry_run: true, command: input.command },
        home,
        now,
      );
      return done.ok
        ? { harness, ...done.value }
        : { harness, skill: "failed", hook: "failed", files: [] };
    }),
  );
  return ok(rows);
}

export async function runHarnessUninstall(
  input: { harness: HarnessId },
  home: string,
): Promise<Result<{ hook: string; files: string[] }, LophnError>> {
  const done = await uninstallGlobal(nodePorts, {
    harness: input.harness,
    home,
  });
  return done.ok ? ok(done.value) : err(done.error);
}
