// harness 감지다. 실행 파일(PATH와 home 기준 bin 폴더 몇 곳), version을 확인한다. 확인하지 못하면
// 확인 못함(unknown)이고 부재나 성공으로 바꾸지 않는다. 결과는 저장하지 않는다. 사람 요청이 올 때마다 다시 한다.
import { posix, win32 } from "node:path";
import { err, formatAt, ok, type Result } from "../../base/mod.ts";
import type { OsPlatform } from "../../base/os/mod.ts";
import {
  HARNESS_ADAPTERS,
  type HarnessAdapter,
  type HarnessCandidate,
  type HarnessDetection,
  type HarnessId,
  type HarnessProbeResult,
  type HarnessVersion,
} from "../../protocol/coding-agent/mod.ts";

// PATH 뒤에 읽는 home 기준 bin 폴더다. shell RC는 평가하지 않는다.
const HOME_DIRS = [
  ".local/bin",
  ".bun/bin",
  ".npm-global/bin",
  ".pnpm-global/bin",
  ".yarn/bin",
  ".volta/bin",
  ".asdf/shims",
  ".fnm/aliases/default/bin",
  ".local/share/mise/shims",
] as const;

// win32의 %APPDATA%·%LOCALAPPDATA%는 home 아래가 아닐 수 있어 env로 읽는다. 쓰는 CLI가 까는 곳만 둔다.
function fallbackDirs(
  platform: OsPlatform,
  home: string,
  env: DetectPorts["env"],
): { dir: string; source: string }[] {
  const dirs: { dir: string; source: string }[] = [];
  const add = (dir: string, name: string) =>
    dirs.push({ dir, source: `fallback:${name}` });
  if (platform === "win32") {
    const appData = env.get("APPDATA");
    const local = env.get("LOCALAPPDATA");
    if (appData) add(win32.join(appData, "npm"), "%APPDATA%\\npm");
    if (local) add(win32.join(local, "Programs"), "%LOCALAPPDATA%\\Programs");
    add(win32.join(home, ".local", "bin"), ".local/bin");
    add(win32.join(home, ".bun", "bin"), ".bun/bin");
    return dirs;
  }
  for (const dir of HOME_DIRS) add(`${home}/${dir}`, dir);
  if (platform === "darwin") {
    add("/opt/homebrew/bin", "/opt/homebrew/bin");
    add("/usr/local/bin", "/usr/local/bin");
  }
  return dirs;
}

// Windows는 이름에 PATHEXT 확장자를 붙여 그 순서로 찾는다.
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function pathextOf(env: DetectPorts["env"]): string[] {
  return (env.get("PATHEXT") || DEFAULT_PATHEXT)
    .split(";")
    .filter((ext) => ext !== "")
    .map((ext) => ext.toLowerCase());
}

// probe가 끝난 모양이다. exit가 null이면 시간 안에 끝나지 않았다.
export type ProbeOutput = { exit: number | null; text: string };

type DetectPorts = {
  // 파일이 없으면 null, 있으면 실행 권한 여부다. 읽지 못하면 오류다.
  executable(path: string): Result<boolean | null>;
  // argv만 쓰고 shell을 열지 않는다.
  run(argv: readonly string[]): Promise<Result<ProbeOutput>>;
  path: string | undefined;
  home: string;
  platform: OsPlatform;
  env: { get(name: string): string | undefined };
};

type DetectInput = {
  // version probe를 돌릴지다. `harness refresh`만 돈다.
  probe: boolean;
  now: string;
};

type Found = {
  discovery: HarnessDetection["discovery"];
  candidates: HarnessCandidate[];
  selected: string | null;
};

export function discover(
  adapter: HarnessAdapter,
  ports: Pick<DetectPorts, "executable" | "path" | "home" | "platform" | "env">,
): Found {
  const { platform } = ports;
  const win = platform === "win32";
  const home = ports.home.replace(win ? /[\\/]$/ : /\/$/, "");
  const dirs = [
    ...(ports.path ?? "")
      .split(win ? win32.delimiter : posix.delimiter)
      .filter((dir) => dir !== "")
      .map((dir) => ({ dir, source: "PATH" })),
    ...fallbackDirs(platform, home, ports.env),
  ];
  const exts = win ? pathextOf(ports.env) : [""];
  const candidates: HarnessCandidate[] = [];
  for (const { dir, source } of dirs) {
    for (const [name, ext] of adapter.commands.flatMap((one) =>
      exts.map((ext) => [one, ext] as const),
    )) {
      const path = win ? win32.join(dir, name + ext) : `${dir}/${name}`;
      const found = ports.executable(path);
      if (!found.ok) {
        return { discovery: "unknown", candidates, selected: null };
      }
      if (found.value === null) continue;
      candidates.push({
        path,
        source,
        executable_result: found.value ? "ok" : "not_executable",
      });
    }
  }
  const selected =
    candidates.find((one) => one.executable_result === "ok")?.path ?? null;
  if (selected !== null) return { discovery: "detected", candidates, selected };
  return {
    discovery: candidates.length === 0 ? "absent" : "unknown",
    candidates,
    selected: null,
  };
}

const SEMVER = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/;

function unknownVersion(reason: string): HarnessVersion {
  return { result: "unknown", value: null, reason };
}

async function probeOne(
  adapter: HarnessAdapter,
  executable: string,
  ports: DetectPorts,
): Promise<{ version: HarnessVersion; results: HarnessProbeResult[] }> {
  const results: HarnessProbeResult[] = [];
  let version = unknownVersion("이 제품은 version 확인 방법이 없다");
  const run = async (argv: readonly string[]) => {
    const ran = await ports.run([executable, ...argv.slice(1)]);
    if (!ran.ok) {
      results.push({
        probe: "version",
        outcome: "unavailable",
        detail: ran.error.message,
      });
      return null;
    }
    if (ran.value.exit === null) {
      results.push({
        probe: "version",
        outcome: "timeout",
        detail: "시간 안에 끝나지 않았다",
      });
      return null;
    }
    results.push({
      probe: "version",
      outcome: ran.value.exit === 0 ? "ok" : "failed",
      detail: `종료 ${ran.value.exit}`,
    });
    return ran.value;
  };
  if (adapter.version_probe !== null) {
    const done = await run(adapter.version_probe.argv);
    if (done === null) {
      version = unknownVersion("version 확인이 끝나지 않았다");
    } else {
      const first =
        done.text.split("\n").find((line) => line.trim() !== "") ?? "";
      const found = SEMVER.exec(first);
      version =
        done.exit === 0 && found !== null
          ? { result: "verified", value: found[1], reason: null }
          : {
              result: "error",
              value: null,
              reason: `version 확인이 종료 ${done.exit}로 끝났다`,
            };
    }
  }
  return { version, results };
}

async function detectOne(
  adapter: HarnessAdapter,
  ports: DetectPorts,
  input: DetectInput,
): Promise<HarnessDetection> {
  const found = discover(adapter, ports);
  let version = unknownVersion(
    input.probe
      ? "version 확인 방법이 없다"
      : "version probe를 실행하지 않았다",
  );
  let results: HarnessProbeResult[] = [];
  if (input.probe && found.selected !== null) {
    ({ version, results } = await probeOne(adapter, found.selected, ports));
  }
  return {
    harness_id: adapter.id,
    observed_at: formatAt(new Date(input.now).getTime()),
    discovery: found.discovery,
    candidates: found.candidates,
    selected_executable: found.selected,
    version,
    probe_results: results,
  };
}

export async function detectHarnesses(
  ports: DetectPorts,
  input: DetectInput,
): Promise<Result<HarnessDetection[]>> {
  if (Number.isNaN(new Date(input.now).getTime())) {
    return err({ code: "invalid_input", message: "시각이 맞지 않다" });
  }
  const list: HarnessDetection[] = [];
  for (const id of Object.keys(HARNESS_ADAPTERS) as HarnessId[]) {
    list.push(await detectOne(HARNESS_ADAPTERS[id], ports, input));
  }
  return ok(list);
}
