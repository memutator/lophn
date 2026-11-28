// `lophn harness detect|refresh|install|status|uninstall`의 실행이다. 감지·설치 engine을 부르는 일만 하고 새 규칙은 없다.
// `install`·`uninstall`은 home 기준 전역 위치에 쓴다.
// `detect`는 실행 파일만 찾고 `refresh`는 version probe까지 돈다. 결과는 저장하지 않는다.
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  err,
  errorCode,
  type LophnError,
  ok,
  type Result,
} from "../../base/mod.ts";
import {
  HARNESS_ADAPTERS,
  type HarnessDetection,
  type HarnessId,
  HARNESS_IDS,
} from "../../protocol/coding-agent/mod.ts";
import {
  detectHarnesses,
  executableOf,
  installGlobal,
  type InstallPorts,
  runProbe,
  type SharedSkill,
  type SkillCopyResult,
  syncSkillCopies,
  uninstallGlobal,
} from "../harnesses/mod.ts";
import { LOPHN_AGENT_SKILL } from "../skills/lophn-agent.ts";
import type { LocalContext } from "./types.ts";

export function runHarnessDetect(
  mode: "detect" | "refresh",
  local: LocalContext,
): Promise<Result<HarnessDetection[], LophnError>> {
  const probeEnv: Record<string, string> = {};
  // Windows의 .cmd shim은 cmd.exe와 node를 찾는 데 이 값들이 필요하다.
  const names =
    process.platform === "win32"
      ? [
          "PATH",
          "HOME",
          "USERPROFILE",
          "APPDATA",
          "SystemRoot",
          "ComSpec",
          "PATHEXT",
        ]
      : ["PATH", "HOME"];
  for (const name of names) {
    const value = local.env.get(name);
    if (value !== undefined) probeEnv[name] = value;
  }
  return detectHarnesses(
    {
      executable: executableOf,
      run: (argv) => runProbe(argv, probeEnv),
      path: local.env.get("PATH"),
      home: local.home,
      platform: process.platform,
      env: local.env,
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
    // 쓰는 중에 끝나도 설정이 반쯤 쓰인 채 남지 않게 같은 폴더의 tmp에 쓰고 rename한다.
    // symlink인 dotfile은 실제 대상을 고치고 권한은 있던 file의 것을 따른다.
    let target = path;
    let mode: number | undefined;
    try {
      target = await realpath(path);
      mode = (await stat(target)).mode & 0o7777;
    } catch (thrown) {
      if (errorCode(thrown) !== "ENOENT") throw thrown;
    }
    const tmp = `${target}.${process.pid}.tmp`;
    try {
      // 폴더가 이미 있으면 file 하나의 권한만으로 쓴다(폴더째 권한을 열지 않는 harness가 있다).
      try {
        await writeFile(tmp, text);
      } catch (thrown) {
        if (errorCode(thrown) !== "ENOENT") throw thrown;
        await mkdir(dirname(target), { recursive: true });
        await writeFile(tmp, text);
      }
      const want = executable === true ? 0o755 : mode;
      if (want !== undefined) await chmod(tmp, want);
      await rename(tmp, target);
    } catch (thrown) {
      await rm(tmp, { force: true });
      throw thrown;
    }
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
  // rmdir은 file에 ENOTDIR(Windows는 ENOENT)로 던지므로 그때만 rm으로 지운다. 정말 없는 path면 rm도 ENOENT로 던진다.
  remove: async (path) => {
    try {
      await rmdir(path);
    } catch (thrown) {
      const code = errorCode(thrown);
      if (code !== "ENOTDIR" && code !== "ENOENT") throw thrown;
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
  if (!done.ok) return err(done.error);
  // lophn이 쓴 공유 skill 사본도 같이 지운다. 같은 폴더를 쓰는 다른 harness의 hook이 남았으면 다음 sync-skills가 다시 둔다.
  const skillDir = HARNESS_ADAPTERS[input.harness].skill_dir;
  if (skillDir === null) return ok(done.value);
  const sep = home.includes("\\") || /^[A-Za-z]:[\\/]/.test(home) ? "\\" : "/";
  const dir = `${home.replace(/[\\/]+$/, "")}${sep}${skillDir.replaceAll("/", sep)}`;
  const copies = await syncSkillCopies(nodePorts, { dir, skills: [] });
  return ok({
    hook: done.value.hook,
    files: [
      ...done.value.files,
      ...copies.removed.map((name) => `${dir}${sep}${name}`),
    ],
  });
}

export type SkillSyncRow = SkillCopyResult & {
  /** 이 폴더를 쓰는 harness들. */
  harnesses: HarnessId[];
  dir: string;
};

// hook을 놓은 harness의 skill 폴더에 배포한 앱 skill 사본을 맞춘다: `skills`는 앱의 public skill이고 `deployed`에 이름이 적힌 것만 둔다.
// hook이 없는 harness의 폴더는 lophn이 쓴 앱 skill 사본만 지운다.
// hook 상태를 못 읽은 폴더(`failed`)는 건드리지 않는다. codex와 pi는 폴더를 같이 쓰므로 하나라도 놓였으면 둔다.
// lophn-agent skill은 hook과 상관없이 모든 harness skill 폴더에 늘 둔다.
export async function runHarnessSyncSkills(
  input: {
    // `app`은 앱 id다. 배포 기록이 가리키는 앱이다.
    skills: (SharedSkill & { app: string })[];
    deployed: readonly { app: string; skill: string }[];
  },
  home: string,
  now: string,
): Promise<Result<SkillSyncRow[], LophnError>> {
  const sep = home.includes("\\") || /^[A-Za-z]:[\\/]/.test(home) ? "\\" : "/";
  const root = home.replace(/[\\/]+$/, "");
  const status = await runHarnessStatus({}, root, now);
  if (!status.ok) return status;
  const byDir = new Map<string, { id: HarnessId; hook: string }[]>();
  for (const row of status.value) {
    const skillDir = HARNESS_ADAPTERS[row.harness].skill_dir;
    if (skillDir === null) continue;
    byDir.set(skillDir, [
      ...(byDir.get(skillDir) ?? []),
      { id: row.harness, hook: row.hook },
    ]);
  }
  const named = new Set(
    input.deployed.map((one) => `${one.app}\0${one.skill}`),
  );
  const wanted = input.skills.filter((one) =>
    named.has(`${one.app}\0${one.name}`),
  );
  const rows: SkillSyncRow[] = [];
  for (const [skillDir, harnesses] of byDir) {
    const installed = harnesses.some((one) => one.hook === "unchanged");
    if (!installed && !harnesses.every((one) => one.hook === "missing")) {
      continue;
    }
    const dir = `${root}${sep}${skillDir.replaceAll("/", sep)}`;
    try {
      const done = await syncSkillCopies(nodePorts, {
        dir,
        skills: [LOPHN_AGENT_SKILL, ...(installed ? wanted : [])],
      });
      rows.push({ ...done, harnesses: harnesses.map((one) => one.id), dir });
    } catch {
      return err({
        code: "unavailable",
        message: `cannot write the skill copies in ${dir}`,
      });
    }
  }
  return ok(rows);
}
