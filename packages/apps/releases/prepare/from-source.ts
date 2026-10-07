// 연결된 source의 commit 하나에서 봉인 bundle까지 준비한다(apps/releases#R1–R4, apps/sdk#R7, R10, R34).
// release worker 안에서 돈다: commit을 staging에 풀고, 앱 import map을 bundle 안 설치 사본 경로로
// 잠그고, blueprint 값을 권한 좁은 Deno로 평가하고, 앱의 화면 build를 직접 돌린 결과를 `prepareRelease`에
// 넘긴다. staging은 끝나면 늘 지운다.
import { err, type Result } from "../../../base/mod.ts";
import { devImportMap } from "../../sdk/mod.ts";
import { lockAppImports, readSdkCopies } from "../bundle/lock.ts";
import { runtimeEntry } from "../bundle/runtime-entry.ts";
import {
  buildEnvironment,
  denoDirOf,
  esbuildBinaries,
} from "../ui-build/binaries.ts";
import { FIXED_UI_DEPENDENCIES } from "../ui-build/build.ts";
import {
  extractCommit,
  gitCommandRunner,
  type GitRunner,
} from "./git-extract.ts";
import {
  type PrepareDeps,
  type PreparedRelease,
  type PrepareFailure,
  prepareRelease,
} from "./flow.ts";

export type SourcePrepareInput = {
  dataRoot: string;
  app: string;
  sourceRoot: string;
  commit: string;
  // 설치 SDK 폴더. 기본은 `<dataRoot>/sdk`다.
  sdkRoot?: string;
};

export type SourcePrepareDeps = PrepareDeps & {
  // Deno 실행 파일. 기본은 지금 실행 중인 Deno다.
  deno?: string;
  // 취소 신호. 실행 중인 자식은 SIGKILL하고 부분 결과를 확정하지 않는다.
  signal?: AbortSignal;
  // blueprint 값 평가와 화면 build 한 번의 상한(ms).
  stepLimitMs?: number;
};

// 앱의 진입 module이다. 앱 source에 있어야 하고 runtime entrypoint가 `@lophn/app`으로 불러 온다.
const APP_MODULE = "main.ts";
const STEP_LIMIT_MS = 120_000;

function fail(
  reason: string,
  code: PrepareFailure["code"] = "invalid_input",
): Result<never, PrepareFailure> {
  return err({ code, reason });
}

type Run = { code: number; stdout: string; stderr: string };

async function runDeno(
  deno: string,
  args: readonly string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    limitMs: number;
    env?: Record<string, string>;
    clearEnv?: boolean;
  },
): Promise<Run | "aborted" | "timeout"> {
  if (options.signal?.aborted) return "aborted";
  const child = new Deno.Command(deno, {
    args: [...args],
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.clearEnv === true ? { clearEnv: true } : {}),
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let stopped: "aborted" | "timeout" | undefined;
  const kill = (why: "aborted" | "timeout") => () => {
    stopped ??= why;
    try {
      child.kill("SIGKILL");
    } catch { /* 이미 끝났다 */ }
  };
  const timer = setTimeout(kill("timeout"), options.limitMs);
  const onAbort = kill("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const output = await child.output();
    if (stopped !== undefined) return stopped;
    return {
      code: output.code,
      stdout: new TextDecoder().decode(output.stdout),
      stderr: new TextDecoder().decode(output.stderr),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

const EVAL_BLUEPRINT = new URL("../ui-build/eval-blueprint.ts", import.meta.url)
  .pathname;
const APP_BUILD = new URL("../ui-build/app-build.ts", import.meta.url)
  .pathname;
const PACKAGES_URL = new URL("../../../", import.meta.url).href;
const REPO = new URL("../../../..", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

// 화면 build 결과(dist/screens/<key>/)를 bundle 입력으로 읽는다. 진입 JS는 화면, 나머지는 자원이다.
async function readBuiltScreens(
  staging: string,
): Promise<
  {
    screens: { path: string; bytes: Uint8Array }[];
    assets: { path: string; bytes: Uint8Array }[];
  }
> {
  const screens: { path: string; bytes: Uint8Array }[] = [];
  const assets: { path: string; bytes: Uint8Array }[] = [];
  const root = `${staging}/dist/screens`;
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isDirectory) continue;
    for await (const file of Deno.readDir(`${root}/${entry.name}`)) {
      if (!file.isFile) continue;
      const item = {
        path: `screens/${entry.name}/${file.name}`,
        bytes: await Deno.readFile(`${root}/${entry.name}/${file.name}`),
      };
      (file.name === "main.js" ? screens : assets).push(item);
    }
  }
  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : 1;
  return { screens: screens.sort(byPath), assets: assets.sort(byPath) };
}

function reactPins(
  imports: Readonly<Record<string, string>>,
): { name: string; version: string }[] {
  const pins: { name: string; version: string }[] = [];
  for (const name of ["react", "react-dom"]) {
    const match = /^npm:[^@]+@(\d+\.\d+\.\d+)/.exec(imports[name] ?? "");
    if (match) pins.push({ name, version: match[1] });
  }
  return pins;
}

export async function prepareFromSource(
  input: SourcePrepareInput,
  deps: SourcePrepareDeps = {},
): Promise<Result<PreparedRelease, PrepareFailure>> {
  const git: GitRunner = deps.git ?? gitCommandRunner();
  const deno = deps.deno ?? Deno.execPath();
  const limitMs = deps.stepLimitMs ?? STEP_LIMIT_MS;
  const sdkRoot = input.sdkRoot ?? `${input.dataRoot}/sdk`;
  const denoDir = denoDirOf();
  const platformEntry = runtimeEntry(PACKAGES_URL);
  const aborted = () =>
    deps.signal?.aborted === true || deps.cancelled?.() === true;
  const extracted = await extractCommit(git, {
    sourceRoot: input.sourceRoot,
    commit: input.commit,
  });
  if (!extracted.ok) return fail(extracted.error.reason);
  const find = (path: string) =>
    extracted.value.find((file) => file.path === path);
  const config = find("deno.json");
  if (config === undefined) return fail("deno_json_missing");
  if (find(APP_MODULE) === undefined) return fail("entrypoint_missing");
  if (find("blueprint.ts") === undefined) return fail("blueprint_missing");
  let imports: Record<string, string>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(config.bytes)) as {
      imports?: Record<string, string>;
    };
    imports = parsed.imports ?? {};
  } catch {
    return fail("deno_json_invalid");
  }
  const locked = lockAppImports(imports);
  if (!locked.ok) return fail(locked.error.reason);
  const copies = await readSdkCopies(sdkRoot, locked.value.packages);
  if (!copies.ok) return fail(copies.error.reason);

  if (aborted()) return fail("cancelled");
  const stagingParent = `${input.dataRoot}/apps/${input.app}/staging`;
  const staging = `${stagingParent}/${crypto.randomUUID()}`;
  try {
    await Deno.mkdir(staging, { recursive: true });
    for (const file of extracted.value) {
      const target = `${staging}/${file.path}`;
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeFile(target, file.bytes);
    }
    await Deno.mkdir(`${staging}/.lophn`, { recursive: true });
    // build 도구의 임시 파일도 staging 안에만 둔다.
    await Deno.mkdir(`${staging}/.tmp`, { recursive: true });
    await Deno.writeTextFile(
      `${staging}/.lophn/import-map.json`,
      JSON.stringify(devImportMap(imports, sdkRoot, staging)),
    );
    if (aborted()) return fail("cancelled");

    // `deno eval`은 모든 권한으로 돌므로 쓰지 않는다. read(staging·설치 SDK)만 허락한 `deno run`이다.
    const evaluated = await runDeno(deno, [
      "run",
      "--no-prompt",
      // 앱의 deno.json(설정·task)은 읽지 않는다. 풀이는 신뢰된 import map 하나다.
      "--no-config",
      `--import-map=${staging}/.lophn/import-map.json`,
      `--allow-read=${staging},${sdkRoot}`,
      EVAL_BLUEPRINT,
      `${staging}/blueprint.ts`,
    ], { cwd: staging, signal: deps.signal, limitMs });
    if (evaluated === "aborted") return fail("cancelled");
    if (evaluated === "timeout") return fail("elapsed_ms");
    if (evaluated.code !== 0) return fail("blueprint_eval_failed");
    let blueprint: {
      sdk_dependencies?: { name: string; version: string }[];
    };
    try {
      blueprint = JSON.parse(evaluated.stdout);
    } catch {
      return fail("blueprint_eval_failed");
    }
    const sdkDependencies = blueprint.sdk_dependencies ?? [];

    // 화면 build는 앱이 쓴 build script가 아니라 신뢰된 `ui-build/app-build.ts`가 한다. 앱 코드는 번들될
    // 뿐 실행되지 않는다. run은 deno와 esbuild 실행 파일만, write는 staging만, env는 이름만 허락한다.
    const built = await runDeno(deno, [
      "run",
      "--no-prompt",
      `--config=${REPO}/deno.json`,
      `--allow-read=${staging},${sdkRoot},${denoDir}`,
      `--allow-write=${staging}`,
      "--allow-env",
      `--allow-run=${[deno, ...await esbuildBinaries(denoDir)].join(",")}`,
      APP_BUILD,
      staging,
      sdkRoot,
      denoDir,
    ], {
      cwd: staging,
      signal: deps.signal,
      limitMs,
      env: buildEnvironment(`${staging}/.tmp`),
      clearEnv: true,
    });
    if (built === "aborted") return fail("cancelled");
    if (built === "timeout") return fail("elapsed_ms");
    if (built.code !== 0) {
      console.error(built.stderr);
      return fail("ui_build_failed", "unavailable");
    }
    const screens = await readBuiltScreens(staging);
    if (aborted()) return fail("cancelled");

    return await prepareRelease({
      dataRoot: input.dataRoot,
      app: input.app,
      sourceRoot: input.sourceRoot,
      commit: input.commit,
      entrypoint: platformEntry.entrypoint,
      entryFiles: platformEntry.files,
      blueprintSource: evaluated.stdout.trim(),
      screens: screens.screens,
      assets: screens.assets,
      sdkDependencies,
      uiDependencies: [
        ...sdkDependencies.filter((item) =>
          (FIXED_UI_DEPENDENCIES as readonly string[]).includes(item.name)
        ),
        ...reactPins(imports),
      ],
      sdkCopies: copies.value,
      lockedImports: { ...locked.value.imports, ...platformEntry.imports },
    }, { ...deps, git, cancelled: aborted });
  } catch {
    return fail("staging_failed", "unavailable");
  } finally {
    await Deno.remove(staging, { recursive: true }).catch(() => undefined);
    await Deno.remove(stagingParent).catch(() => undefined);
  }
}
