// 개발 fixture 앱으로 problems app test를 실제 runner 경로로 돌리는 시험 도구다(problems#T12). fixture
// 원본(`.tmpl`)을 앱 폴더로 풀어 source commit → 봉인 bundle을 만들고, runner를 core launch spec의
// 권한 flag 그대로 띄워 `--app-test-job`으로 한 건을 돌린다. 사람 데이터 root(~/.lophn,
// ~/.config/lophn)는 열지 않고 temp lophn home만 쓴다.
import { assert } from "@std/assert";
import { sha256Hex } from "../../../packages/base/mod.ts";
import { prepareFromSource } from "../../../packages/apps/releases/prepare/from-source.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../../../packages/apps/sdk/mod.ts";
import {
  installedHome,
  removeTree,
} from "../../../packages/apps/sdk/testing/mod.ts";
import { launchArgv } from "../../../packages/platform/security/mod.ts";
import {
  type HarnessFailurePath,
  sdkDependenciesHash,
} from "../../../packages/problems/tests/mod.ts";
import type { FrozenTest } from "../../../packages/contracts/problems/mod.ts";
import { canonicalHash } from "../../../packages/problems/tests/canonical.ts";
import { runnerSockets, testRunnerSpec } from "../problems-runner.ts";
import type {
  AppTestJob,
  AppTestJobResult,
} from "../../worker/problems/app-test-run.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";

export type FrozenTestValue = FrozenTest;
const FIXTURES = new URL("../../../fixtures/apps/", import.meta.url).pathname;

export type FixtureName =
  | "rate-limit-dashboard"
  | "todo"
  | "calendar"
  | "broken";

export type MadeFixture = {
  name: FixtureName;
  // 앱 source working tree(git)다.
  dir: string;
  // temp lophn home. SDK 설치·bundle 사본·runner 작업 root가 모두 이 안이다.
  home: string;
  commit(message?: string): Promise<string>;
  dispose(): Promise<void>;
};

export async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

// fixture 원본을 앱 폴더로 풀고 개발용 import map을 둔다.
// fixture가 쓰는 SDK 중 기본 템플릿 묶음에 없는 것이다.
const EXTRA_PACKAGES: Record<FixtureName, string[]> = {
  "rate-limit-dashboard": [
    "@lophn/cap-fs",
    "@lophn/ui-chart",
    "@lophn/ui-filter",
    "@lophn/ui-stat",
    "@lophn/ui-table",
  ],
  todo: ["@lophn/cap-fs"],
  calendar: ["@lophn/cap-net", "@lophn/cap-secret"],
  broken: [],
};

export async function madeFixture(name: FixtureName): Promise<MadeFixture> {
  const installed = await installedHome(EXTRA_PACKAGES[name]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-fixture-app-" });
  const dir = `${parent}/app`;
  const source = `${FIXTURES}${name}/`;
  const config = JSON.parse(
    await Deno.readTextFile(`${source}deno.json.tmpl`),
  ) as { imports: Record<string, string> };
  const files = await readTemplateDirectory(source, { stripSuffix: true });
  assert(files.ok, files.ok ? "" : files.error.message);
  for (const file of files.value) {
    const target = `${dir}/${file.path}`;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeFile(target, file.bytes);
  }
  await Deno.mkdir(`${dir}/.lophn`);
  await Deno.writeTextFile(
    `${dir}/.lophn/import-map.json`,
    JSON.stringify(devImportMap(config.imports, installed.sdkRoot, dir)),
  );
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "dev@lophn.local"]);
  await git(dir, ["config", "user.name", "dev"]);
  return {
    name,
    dir,
    home: installed.home,
    async commit(message = "fixture") {
      await git(dir, ["add", "-A"]);
      await git(dir, ["commit", "-q", "-m", message]);
      return await git(dir, ["rev-parse", "HEAD"]);
    },
    async dispose() {
      await removeTree(parent);
      await installed.dispose();
    },
  };
}

export type SealedBundle = {
  path: string;
  bundleHash: string;
  blueprintHash: string;
};

export async function sealedBundle(made: MadeFixture): Promise<SealedBundle> {
  const commit = await made.commit();
  const prepared = await prepareFromSource({
    dataRoot: made.home,
    app: APP,
    sourceRoot: made.dir,
    commit,
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  return {
    path: prepared.value.copyPath,
    bundleHash: prepared.value.bundleHash,
    blueprintHash: prepared.value.blueprintHash,
  };
}

// 앱이 낸 시험 자료(`tests/app-test.json`)다. 실패 경로 test 목록과 command마다의 fixture 입력이다.
export type AppTestFile = {
  failure_paths: HarnessFailurePath[];
  inputs?: Record<string, unknown>;
  prepare?: AppTestJob["prepare"];
  journal_tables?: string[];
  domain?: AppTestJob["domain"];
  // 돌린 뒤 읽을 fixture 파일이다(앱이 선언한 바깥 자리에 쓴 결과 blob).
  collect_files?: string[];
  // blueprint가 선언한 바깥 자리에 둘 fixture 파일이다. 읽거나 쓸 수 없는 상태(폴더가 파일 자리에 있다)를
  // 만들어 선언 code의 실패를 실제로 낸다. 요청한 쪽이 만들고 돌린 뒤 지운다(runner 작업 root 밖이다).
  fixture_files?: { path: string; kind: "dir" | "file"; text?: string }[];
};

export async function readAppTestFile(bundle: string): Promise<AppTestFile> {
  return JSON.parse(
    await Deno.readTextFile(`${bundle}/tests/app-test.json`),
  ) as AppTestFile;
}

export type RunOptions = {
  // 요청 키. 같은 temp home에서 여러 번 돌릴 때 서로 달라야 한다.
  key: string;
  // 고정 시험을 바꾼다(testdata 변형).
  failure_paths?: HarnessFailurePath[];
  frozen_failure_paths?: { code: string; test_hash: string }[];
  previous_schema?: number | null;
  screen_host?: { command: string; args: string[] } | null;
  timeout_ms?: number;
};

export type RunOutcome = {
  // 이 실행의 고정 시험(FrozenTest)과 hash다. RecordVerification의 test와 같다.
  frozen: FrozenTestValue;
  test_hash: string;
  result: AppTestJobResult;
  stderr: string;
  // `collect_files`의 내용이다. 읽을 수 없으면 null이다.
  files: Record<string, string | null>;
};

// runner를 core launch spec이 정한 권한 그대로 띄워 app test 한 건을 돌린다.
export async function runAppTest(
  made: MadeFixture,
  bundle: SealedBundle,
  options: RunOptions,
): Promise<RunOutcome> {
  const file = await readAppTestFile(bundle.path);
  const scenarios = options.failure_paths ?? file.failure_paths;
  const spec = testRunnerSpec({
    dataRoot: made.home,
    deno: Deno.execPath(),
    screenHost: options.screen_host?.command,
  });
  assert(spec, "runner launch spec was refused");
  await Deno.mkdir(`${made.home}/work/problems/tests/sock`, {
    recursive: true,
  });
  const work = `${made.home}/work/problems/tests/${options.key}`;
  const blueprint = JSON.parse(
    await Deno.readTextFile(`${bundle.path}/blueprint.json`),
  ) as { sdk_dependencies: { name: string; version: string }[] };
  const frozenPaths = options.frozen_failure_paths ??
    scenarios.map((path) => ({
      code: path.code,
      test_hash: canonicalHash(path),
    }));
  const frozen: FrozenTestValue = {
    code: bundle.bundleHash,
    input: await sha256Hex(JSON.stringify(file.inputs ?? {})),
    expected: await sha256Hex("every required check passes"),
    method: {
      argv: ["test", "child_test.ts"],
      cwd: ".",
      timeout_ms: options.timeout_ms ?? 240_000,
      expected_exit_code: 0,
      environment: await sha256Hex("problems/tests runner environment"),
    },
    blueprint: bundle.blueprintHash,
    sdk_dependencies: sdkDependenciesHash(blueprint.sdk_dependencies),
    failure_paths: frozenPaths,
    symptom: null,
  };
  const testHash = canonicalHash(frozen);
  const job: AppTestJob = {
    request_key: options.key,
    slot: 0,
    work,
    sockets: runnerSockets(made.home, 0),
    bundle: bundle.path,
    bundle_hash: bundle.bundleHash,
    blueprint_hash: bundle.blueprintHash,
    scenarios,
    frozen_failure_paths: frozenPaths,
    test_hash: testHash,
    inputs: file.inputs ?? {},
    prepare: file.prepare,
    journal_tables: file.journal_tables,
    domain: file.domain,
    previous_schema: options.previous_schema === undefined
      ? 1
      : options.previous_schema,
    previous_declarations: null,
    screen_host: options.screen_host ?? null,
    timeout_ms: options.timeout_ms ?? 240_000,
    deno: Deno.execPath(),
    environment: {
      ...(Deno.env.get("HOME") ? { home: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("DENO_DIR")
        ? { denoDir: Deno.env.get("DENO_DIR")! }
        : {}),
    },
  };
  const env: Record<string, string> = {
    LOPHN_HOME: made.home,
    LOPHN_WORKER_KIND: spec!.kind,
    ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
    ...(Deno.env.get("DENO_DIR")
      ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
      : {}),
    ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
    ...(Deno.env.get("XDG_RUNTIME_DIR")
      ? { XDG_RUNTIME_DIR: Deno.env.get("XDG_RUNTIME_DIR")! }
      : {}),
    ...(Deno.env.get("DBUS_SESSION_BUS_ADDRESS")
      ? { DBUS_SESSION_BUS_ADDRESS: Deno.env.get("DBUS_SESSION_BUS_ADDRESS")! }
      : {}),
    ...(Deno.env.get("DISPLAY") ? { DISPLAY: Deno.env.get("DISPLAY")! } : {}),
    ...(Deno.env.get("XAUTHORITY")
      ? { XAUTHORITY: Deno.env.get("XAUTHORITY")! }
      : {}),
  };
  const placed: string[] = [];
  for (const item of file.fixture_files ?? []) {
    await Deno.mkdir(
      item.kind === "dir"
        ? item.path
        : item.path.slice(0, item.path.lastIndexOf("/")),
      { recursive: true },
    );
    if (item.kind === "file") {
      await Deno.writeTextFile(item.path, item.text ?? "");
    }
    placed.push(item.path);
  }
  try {
    const outcome = await spawnRunner();
    for (const path of file.collect_files ?? []) {
      outcome.files[path] = await Deno.readTextFile(path).catch(() => null);
    }
    return outcome;
  } finally {
    for (const path of placed) {
      await Deno.remove(path, { recursive: true }).catch(() => undefined);
    }
  }

  async function spawnRunner(): Promise<RunOutcome> {
    const child = new Deno.Command(Deno.execPath(), {
      args: [...launchArgv(spec!), "--app-test-job"],
      clearEnv: true,
      env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify(job)));
    await writer.close();
    const output = await child.output();
    const stderr = new TextDecoder().decode(output.stderr);
    assert(
      output.success,
      `runner exited ${output.code}\n${stderr}\n${
        new TextDecoder().decode(output.stdout)
      }`,
    );
    const parsed = JSON.parse(new TextDecoder().decode(output.stdout)) as
      | { ok: true; value: AppTestJobResult }
      | { ok: false; error: { code: string; message: string } };
    assert(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.error) + stderr);
    return {
      frozen,
      test_hash: testHash,
      result: parsed.value,
      stderr,
      files: {},
    };
  }
}

export function hashOf(text: string): Promise<string> {
  return sha256Hex(text);
}

// testdata 변형(packages/problems/tests/testdata/bundle-variants.json)이 봉인 bundle 사본에 거는 고침이다.
export type BundleVariant = {
  name: string;
  requirement: string;
  base: FixtureName;
  failure_paths?: "none" | "direct";
  patch?: { file: string; from: string; to: string }[];
  blueprint_add_automation?: Record<string, unknown>;
  rename?: Record<string, string>;
  expect_fail: string[];
  expect_pass?: string[];
};

async function copyTree(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    const source = `${from}/${entry.name}`;
    const target = `${to}/${entry.name}`;
    if (entry.isDirectory) await copyTree(source, target);
    else if (entry.isFile) {
      await Deno.writeFile(target, await Deno.readFile(source));
    }
  }
}

async function digestOfTree(root: string): Promise<string> {
  const lines: string[] = [];
  async function visit(directory: string, relative: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory) await visit(`${directory}/${entry.name}`, path);
      else if (entry.isFile) {
        const text = await Deno.readTextFile(`${directory}/${entry.name}`);
        lines.push(`${path} ${await sha256Hex(text)}`);
      }
    }
  }
  await visit(root, "");
  return await sha256Hex(lines.sort().join("\n"));
}

// 봉인 bundle 사본을 새 폴더로 복사해 변형을 건다. 변형한 폴더의 hash는 실제 쓴 파일 내용으로 다시 구한다.
export async function variantBundle(
  made: MadeFixture,
  base: SealedBundle,
  variant: BundleVariant,
): Promise<SealedBundle> {
  const path = `${made.home}/variants/${variant.name}`;
  await copyTree(base.path, path);
  for (const edit of variant.patch ?? []) {
    const file = `${path}/${edit.file}`;
    const text = await Deno.readTextFile(file);
    assert(
      text.includes(edit.from),
      `${edit.file} does not contain the text to change`,
    );
    await Deno.writeTextFile(file, text.replace(edit.from, edit.to));
  }
  if (variant.blueprint_add_automation) {
    const file = `${path}/blueprint.json`;
    const blueprint = JSON.parse(await Deno.readTextFile(file)) as {
      automatic_tasks: unknown[];
    };
    blueprint.automatic_tasks.push(variant.blueprint_add_automation);
    await Deno.writeTextFile(file, JSON.stringify(blueprint));
  }
  for (const [from, to] of Object.entries(variant.rename ?? {})) {
    await Deno.rename(`${path}/${from}`, `${path}/${to}`);
  }
  const blueprintText = await Deno.readTextFile(`${path}/blueprint.json`);
  return {
    path,
    bundleHash: await digestOfTree(path),
    blueprintHash: await sha256Hex(blueprintText),
  };
}
