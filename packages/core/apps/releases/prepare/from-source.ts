// 연결된 source의 commit 하나에서 봉인 bundle까지 준비한다.
// release worker 안에서 돈다: commit을 staging에 풀고, 앱 import map을 bundle 안 설치 사본 경로로
// 잠그고, blueprint 값을 권한 좁은 Deno로 평가하고, 앱의 화면 build를 직접 돌리고, npm·jsr 의존을 한 번
// 받아 둔 결과를 `prepareRelease`에 넘긴다. 운영 process는 network 없이 bundle 안 사본만 읽는다.
// staging은 끝나면 늘 지운다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { appStagingFolder } from "../../../../protocol/apps/mod.ts";
import { devImportMap } from "../../packages/mod.ts";
import { lockAppImports, readSdkCopies } from "../bundle/lock.ts";
import { runtimeEntry } from "../bundle/runtime-entry.ts";
import { readVendorFiles } from "../bundle/vendor.ts";
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

type SourcePrepareInput = {
  dataRoot: string;
  app: string;
  sourceRoot: string;
  commit: string;
};

type SourcePrepareDeps = PrepareDeps & {
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
const PACKAGES_URL = new URL("../../../../", import.meta.url).href;
const REPO = new URL("../../../../../", import.meta.url).pathname.replace(
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

// npm·jsr 의존을 한 번 받아서 `vendor/`(jsr)와 `node_modules/`(npm)에 둔다. `deno cache`가 network를 쓰는
// 유일한 단계이고 앱 코드는 실행하지 않는다. 받은 사본은 bundle에 담겨 운영 process가 그대로 읽는다.
async function fetchExternal(
  deno: string,
  specifiers: readonly string[],
  directory: string,
  options: {
    signal?: AbortSignal;
    limitMs: number;
    env: Record<string, string>;
  },
): Promise<Result<{ path: string; bytes: Uint8Array }[], PrepareFailure>> {
  if (specifiers.length === 0) return ok([]);
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeTextFile(
    `${directory}/deno.json`,
    JSON.stringify({ vendor: true, nodeModulesDir: "auto" }),
  );
  // 정확한 pin 하나씩과 앱이 쓰는 하위 경로까지 불러 와야 그 module이 사본에 든다.
  await Deno.writeTextFile(
    `${directory}/deps.ts`,
    specifiers.map((specifier) => `import ${JSON.stringify(specifier)};\n`)
      .join(""),
  );
  const fetched = await runDeno(deno, [
    "cache",
    "--no-lock",
    `--config=${directory}/deno.json`,
    `${directory}/deps.ts`,
  ], {
    cwd: directory,
    signal: options.signal,
    limitMs: options.limitMs,
    env: options.env,
    clearEnv: true,
  });
  if (fetched === "aborted") return fail("cancelled");
  if (fetched === "timeout") return fail("elapsed_ms");
  if (fetched.code !== 0) return fail("dependency_fetch_failed", "unavailable");
  const files = await readVendorFiles(directory);
  if (!files.ok) return fail(files.error.reason, "unavailable");
  return ok(files.value);
}

export async function prepareFromSource(
  input: SourcePrepareInput,
  deps: SourcePrepareDeps = {},
): Promise<Result<PreparedRelease, PrepareFailure>> {
  const git: GitRunner = deps.git ?? gitCommandRunner();
  const deno = deps.deno ?? Deno.execPath();
  const limitMs = deps.stepLimitMs ?? STEP_LIMIT_MS;
  const sdkRoot = `${input.dataRoot}/sdk`;
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
  const copies = await readSdkCopies(input.dataRoot, locked.value.packages);
  if (!copies.ok) return fail(copies.error.reason);

  if (aborted()) return fail("cancelled");
  const stagingParent = appStagingFolder(input.dataRoot, input.app);
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
      JSON.stringify(devImportMap(imports, input.dataRoot, staging)),
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

    // 화면 build는 앱이 쓴 build script가 아니라 신뢰된 `ui-build/app-build.ts`가 한다. 앱 코드는 번들될
    // 뿐 실행되지 않는다. run은 deno와 esbuild 실행 파일만(호출자가 `cacheBuildTools`로 미리 받아 둔다), env는 이름만 허락한다. write는 staging과, esbuild deno
    // loader가 npm 사본을 hardlink로 모으는 deno-dir 폴더 셋이다(`Deno.link`는 원본 쪽에도 write를 요구해 npm 폴더가 든다).
    const built = await runDeno(deno, [
      "run",
      "--no-prompt",
      `--config=${REPO}/deno.json`,
      `--allow-read=${staging},${sdkRoot},${denoDir}`,
      `--allow-write=${staging},${denoDir}/npm,${denoDir}/deno_esbuild,${denoDir}/deno_esbuild_tmp`,
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

    // 잠근 npm·jsr 값(하위 경로 포함)을 한 번 받아 둔다. 같은 값은 한 번만 부른다.
    const specifiers = [
      ...new Set(
        Object.values(locked.value.imports).filter((value) =>
          value.startsWith("npm:") || value.startsWith("jsr:")
        ).map((value) => value.replace(/\/$/, "")),
      ),
    ].sort();
    const vendored = await fetchExternal(
      deno,
      specifiers,
      `${staging}/.lophn/deps`,
      {
        signal: deps.signal,
        limitMs,
        env: buildEnvironment(`${staging}/.tmp`),
      },
    );
    if (!vendored.ok) return vendored;
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
      dependencies: [
        ...locked.value.packages.map((item) => ({
          ...item,
          source: item.name.startsWith("@me/")
            ? "package" as const
            : "sdk" as const,
        })),
        ...locked.value.external,
      ],
      uiDependencies: [
        ...locked.value.packages.filter((item) =>
          (FIXED_UI_DEPENDENCIES as readonly string[]).includes(item.name)
        ),
        ...reactPins(imports),
      ],
      sdkCopies: copies.value,
      vendorCopies: vendored.value,
      lockedImports: { ...locked.value.imports, ...platformEntry.imports },
    }, { ...deps, git, cancelled: aborted });
  } catch {
    return fail("staging_failed", "unavailable");
  } finally {
    await Deno.remove(staging, { recursive: true }).catch(() => undefined);
    await Deno.remove(stagingParent).catch(() => undefined);
  }
}
