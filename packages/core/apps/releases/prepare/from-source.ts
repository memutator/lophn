// 연결된 source의 commit 하나에서 봉인 bundle까지 준비한다.
// release worker 안에서 돈다: commit을 staging에 풀고, package.json이 거는 SDK 사본을 staging의
// `.lophn/sdk`에 채우고, npm으로 의존을 받고, 선언 값을 평가하고, 앱의 화면 build를 직접 돌리고, 받아 둔
// node_modules를 bundle 파일로 읽어 `prepareRelease`에 넘긴다. 운영 process는 network 없이 bundle 안 사본만
// 읽는다. staging은 끝나면 늘 지운다.
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { err, type Result } from "../../../../base/mod.ts";
import { appStagingFolder } from "../../../../protocol/apps/mod.ts";
import {
  type NodeCommand,
  nodeCommand,
  npmCommand,
} from "../../../supervision/security/node-command.ts";
import { syncAppSdk } from "../../packages/mod.ts";
import {
  appDependencies,
  type PackageManifest,
} from "../bundle/dependencies.ts";
import { readModules, readSdkCopies } from "../bundle/modules.ts";
import { runtimeEntry } from "../bundle/runtime-entry.ts";
import { FIXED_UI_DEPENDENCIES } from "../ui-build/build.ts";
import { childEnvironment } from "./environment.ts";
import {
  type PrepareDeps,
  type PreparedRelease,
  type PrepareFailure,
  prepareRelease,
} from "./flow.ts";
import {
  extractCommit,
  type GitRunner,
  gitCommandRunner,
} from "./git-extract.ts";

type SourcePrepareInput = {
  dataRoot: string;
  app: string;
  sourceRoot: string;
  commit: string;
};

type SourcePrepareDeps = PrepareDeps & {
  // 취소 신호. 실행 중인 자식은 SIGKILL하고 부분 결과를 확정하지 않는다.
  signal?: AbortSignal;
  // npm install·선언 eval·화면 build 한 번의 상한(ms).
  stepLimitMs?: number;
};

// 앱의 진입 module이다. 앱 source에 있어야 하고 runtime entrypoint가 entry 파일에서 불러 온다.
const APP_MODULE = "main.ts";
const PACKAGE_MANIFEST = "package.json";
const STEP_LIMIT_MS = 120_000;

function fail(
  reason: string,
  code: PrepareFailure["code"] = "invalid_input",
): Result<never, PrepareFailure> {
  return err({ code, reason });
}

// 자식 stderr의 앞 5줄 500자. 색 escape와 staging 경로를 지워 앱 source 기준 경로로 보이게 한다.
// reason에 붙어 agent가 고칠 곳(선언, 화면 code, package 판)을 가리킨다.
function childHead(code: string, stderr: string, staging: string): string {
  const esc = String.fromCharCode(27);
  const text = stderr
    .replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "")
    .replaceAll(`file://${staging}/`, "")
    .replaceAll(`${staging}/`, "")
    .split("\n")
    .slice(0, 5)
    .join("\n")
    .trim();
  if (text === "") return code;
  return `${code}: ${text.length > 500 ? `${text.slice(0, 500)}...` : text}`;
}

type Run = { code: number; stdout: string; stderr: string };

async function runChild(
  launch: NodeCommand,
  options: {
    cwd: string;
    signal?: AbortSignal;
    limitMs: number;
    env: Record<string, string>;
  },
): Promise<Run | "aborted" | "timeout"> {
  if (options.signal?.aborted) return "aborted";
  const child = spawn(launch.command, launch.args, {
    cwd: options.cwd,
    // 자식은 필요한 환경만 받는다. nodeCommand의 env(Electron을 Node로 띄우는 값)를 더한다.
    env: { ...options.env, ...launch.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => outChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
  let stopped: "aborted" | "timeout" | undefined;
  const kill = (why: "aborted" | "timeout") => () => {
    stopped ??= why;
    try {
      child.kill("SIGKILL");
    } catch {
      /* 이미 끝났다 */
    }
  };
  const timer = setTimeout(kill("timeout"), options.limitMs);
  const onAbort = kill("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    // spawn 실패(ENOENT 등)를 듣지 않으면 unhandled 'error'로 process가 죽는다. 던져서 부르는 쪽이 실패로 다루게 한다.
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });
    if (stopped !== undefined) return stopped;
    return {
      code,
      stdout: Buffer.concat(outChunks).toString("utf8"),
      stderr: Buffer.concat(errChunks).toString("utf8"),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

const EVAL_DECLARATION = new URL(
  "../ui-build/eval-declaration.ts",
  import.meta.url,
).pathname;
const APP_BUILD = new URL("../ui-build/app-build.ts", import.meta.url).pathname;
const PACKAGES_URL = new URL("../../../../", import.meta.url).href;

// 화면 build 결과(dist/screens/<key>/)를 bundle 입력으로 읽는다. 진입 JS는 화면, 나머지는 자원이다.
async function readBuiltScreens(staging: string): Promise<{
  screens: { path: string; bytes: Uint8Array }[];
  assets: { path: string; bytes: Uint8Array }[];
}> {
  const screens: { path: string; bytes: Uint8Array }[] = [];
  const assets: { path: string; bytes: Uint8Array }[] = [];
  const root = `${staging}/dist/screens`;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of await readdir(`${root}/${entry.name}`, {
      withFileTypes: true,
    })) {
      if (!file.isFile()) continue;
      const item = {
        path: `screens/${entry.name}/${file.name}`,
        bytes: await readFile(`${root}/${entry.name}/${file.name}`),
      };
      (file.name === "main.js" ? screens : assets).push(item);
    }
  }
  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : 1;
  return { screens: screens.sort(byPath), assets: assets.sort(byPath) };
}

// 설치 사본은 0444·0555라 staging 사본을 지우거나 npm이 고칠 수 없다. staging 사본만 연다.
async function makeWritable(directory: string): Promise<void> {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await makeWritable(path);
    else if (entry.isFile()) await chmod(path, 0o644);
  }
}

export async function prepareFromSource(
  input: SourcePrepareInput,
  deps: SourcePrepareDeps = {},
): Promise<Result<PreparedRelease, PrepareFailure>> {
  const git: GitRunner = deps.git ?? gitCommandRunner();
  const limitMs = deps.stepLimitMs ?? STEP_LIMIT_MS;
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
  const manifestFile = find(PACKAGE_MANIFEST);
  if (manifestFile === undefined) return fail("package_json_missing");
  if (find(APP_MODULE) === undefined) return fail("entrypoint_missing");
  if (find("lophn.ts") === undefined) return fail("declaration_missing");
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes));
  } catch {
    return fail("package_json_invalid");
  }
  if (typeof manifest !== "object" || manifest === null) {
    return fail("package_json_invalid");
  }
  const dependencies = appDependencies(manifest as PackageManifest);
  if (!dependencies.ok) return fail(dependencies.error.reason);
  const uiDependencies = dependencies.value
    .filter((dependency) =>
      (FIXED_UI_DEPENDENCIES as readonly string[]).includes(dependency.name),
    )
    .map(({ name, version }) => ({ name, version }));
  // lock이 있으면 그대로 받는다. 없으면 package.json에서 풀고 staging의 lock은 bundle에 담지 않는다.
  const install = find("package-lock.json") === undefined ? "install" : "ci";

  if (aborted()) return fail("cancelled");
  const stagingParent = appStagingFolder(input.dataRoot, input.app);
  const staging = `${stagingParent}/${crypto.randomUUID()}`;
  try {
    await mkdir(staging, { recursive: true });
    for (const file of extracted.value) {
      const target = `${staging}/${file.path}`;
      await mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await writeFile(target, file.bytes);
    }
    // npm과 esbuild의 임시 파일도 staging 안에만 둔다.
    await mkdir(`${staging}/.tmp`, { recursive: true });
    if (aborted()) return fail("cancelled");

    const synced = await syncAppSdk(staging, input.dataRoot);
    if (!synced.ok) return fail("sdk_not_installed");
    if (synced.value.length > 0) await makeWritable(`${staging}/.lophn/sdk`);
    if (aborted()) return fail("cancelled");

    // npm이 AI가 쓴 앱의 의존을 받는 유일한 단계다. 앱 code는 실행되지 않는다(install script도 돌리지 않는다:
    // registry의 임의 code를 사람 기계에서 실행할 이유가 없고, bundle에는 설치된 file만 필요하다).
    const installed = await runChild(
      npmCommand([install, "--ignore-scripts"]),
      {
        cwd: staging,
        signal: deps.signal,
        limitMs,
        env: childEnvironment(`${staging}/.tmp`),
      },
    );
    if (installed === "aborted") return fail("cancelled");
    if (installed === "timeout") return fail("elapsed_ms");
    if (installed.code !== 0) {
      return fail(
        childHead("dependency_install_failed", installed.stderr, staging),
        "unavailable",
      );
    }
    if (aborted()) return fail("cancelled");

    // 선언 값은 앱 폴더의 node_modules로 import를 풀어 평가한다. 앱 code는 이 자식에서만 돈다.
    const evaluated = await runChild(
      nodeCommand(EVAL_DECLARATION, [`${staging}/lophn.ts`]),
      {
        cwd: staging,
        signal: deps.signal,
        limitMs,
        env: childEnvironment(`${staging}/.tmp`),
      },
    );
    if (evaluated === "aborted") return fail("cancelled");
    if (evaluated === "timeout") return fail("elapsed_ms");
    if (evaluated.code !== 0) {
      return fail(
        childHead("declaration_eval_failed", evaluated.stderr, staging),
      );
    }

    // 화면 build는 앱이 쓴 build script가 아니라 신뢰된 `ui-build/app-build.ts`가 한다. 앱 코드는 번들될
    // 뿐 실행되지 않는다.
    const built = await runChild(nodeCommand(APP_BUILD, [staging]), {
      cwd: staging,
      signal: deps.signal,
      limitMs,
      env: childEnvironment(`${staging}/.tmp`),
    });
    if (built === "aborted") return fail("cancelled");
    if (built === "timeout") return fail("elapsed_ms");
    if (built.code !== 0) {
      return fail(
        childHead("ui_build_failed", built.stderr, staging),
        "unavailable",
      );
    }
    const screens = await readBuiltScreens(staging);
    if (aborted()) return fail("cancelled");

    const modules = await readModules(staging);
    if (!modules.ok) return fail(modules.error.reason, "unavailable");
    const copies = await readSdkCopies(staging);
    if (!copies.ok) return fail(copies.error.reason, "unavailable");
    if (aborted()) return fail("cancelled");

    return await prepareRelease(
      {
        dataRoot: input.dataRoot,
        app: input.app,
        sourceRoot: input.sourceRoot,
        commit: input.commit,
        entrypoint: platformEntry.entrypoint,
        entryFiles: platformEntry.files,
        declarationSource: evaluated.stdout.trim(),
        screens: screens.screens,
        assets: screens.assets,
        dependencies: dependencies.value,
        uiDependencies,
        sdkCopies: copies.value,
        moduleCopies: modules.value,
      },
      { ...deps, git, cancelled: aborted },
    );
  } catch {
    return fail("staging_failed", "unavailable");
  } finally {
    await rm(staging, { recursive: true }).catch(() => undefined);
    await rmdir(stagingParent).catch(() => undefined);
  }
}
