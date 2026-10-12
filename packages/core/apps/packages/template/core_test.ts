// 앱 템플릿의 끝까지 가는 시험(apps/sdk#R33, R41, apps/releases#R1·R4, shell#T37). 템플릿으로 만든 앱이 자기 test와
// type 검사를 지나고, 화면이 build되고, 그 앱이 release 준비(T6)로 bundle이 되고, 실제 앱 진입점이
// 그 bundle의 `/screens/<screen>/index.html`을 내주고, problems app test의 선언 검사를 지난다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../../../base/mod.ts";
import { prepareRelease, verifySealedPermissions } from "../../releases/mod.ts";
import {
  bundleScreenFiles,
  screenContentType,
} from "../../runtime/entrypoint/screen-files.ts";
import {
  generateAppTestChecks,
  loadSources,
  scanCodeUsage,
  sdkDependenciesHash,
} from "../../../problems/tests/mod.ts";
import {
  APP_TEST_ARGS,
  deno,
  installedHome,
  removeTree,
  scaffoldInto,
} from "../testing/mod.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
const IMPORT_MAP = "--import-map=.lophn/import-map.json";

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

type Made = {
  parent: string;
  dir: string;
  dispose(): Promise<void>;
};

async function madeApp(): Promise<Made> {
  const installed = await installedHome();
  const parent = await Deno.makeTempDir({ prefix: "lophn-template-app-" });
  const dir = `${parent}/app`;
  await scaffoldInto(installed, dir);
  return {
    parent,
    dir,
    async dispose() {
      await removeTree(parent);
      await installed.dispose();
    },
  };
}

Deno.test("apps/sdk#R33 apps/sdk#R41: 템플릿 앱은 잠긴 lock으로 type 검사와 자기 test를 통과한다", async () => {
  const made = await madeApp();
  try {
    const check = await deno(made.dir, [
      "check",
      IMPORT_MAP,
      "--frozen-lockfile",
      "--cached-only",
      "main.ts",
      "blueprint.ts",
      "src/screens/items/main.tsx",
      "scripts/build-ui.ts",
      "tests/blueprint_test.ts",
    ]);
    assertEquals(check.code, 0, check.stderr);
    const tests = await deno(made.dir, APP_TEST_ARGS);
    assertEquals(tests.code, 0, tests.stderr + tests.stdout);
    // blueprint·업무 규칙·실패 경로·문구 test가 모두 돈다.
    for (
      const name of [
        "blueprint: the declaration is valid",
        "items: a new database migrates",
        "failure_path:store_unavailable list_items",
        "wording: placeholders.ts is generated",
      ]
    ) assert(tests.stdout.includes(name), `${name} did not run`);
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/sdk#R41: 고정 문구 직접 삽입·없는 en key·placeholder 불일치는 앱 test에서 실패한다", async () => {
  const made = await madeApp();
  try {
    const screen = `${made.dir}/src/screens/items/app.tsx`;
    const source = await Deno.readTextFile(screen);
    await Deno.writeTextFile(
      screen,
      source + [
        "",
        "export const Broken = () => <p>Saved just now</p>;",
        'export const missing = t("items.title.nowhere");',
        'export const wrong = t("items.label.count", { total: 1 });',
        "",
      ].join("\n"),
    );
    // catalog 문장의 placeholder를 바꾸고 placeholders.ts를 다시 만들지 않는다.
    const catalog = `${made.dir}/src/wording/en.ts`;
    await Deno.writeTextFile(
      catalog,
      (await Deno.readTextFile(catalog)).replace(
        '"items.title.screen": "Items"',
        '"items.title.screen": "Items of {owner}"',
      ),
    );
    const failed = await deno(made.dir, [
      ...APP_TEST_ARGS,
      "tests/wording_test.ts",
    ]);
    assert(failed.code !== 0);
    const output = failed.stdout + failed.stderr;
    for (
      const rule of ["literal-text", "unknown-key", "placeholder-mismatch"]
    ) {
      assert(output.includes(rule), `${rule} was not reported`);
    }
    // 생성한 placeholders.ts가 catalog와 달라진 것도 잡힌다.
    assert(output.includes("placeholders.ts is generated"));
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/sdk#R33 apps/releases#R1 shell#T37: 템플릿 앱 화면 build → release 준비 bundle → 실제 진입점이 /screens/items/index.html을 내준다", async () => {
  const made = await madeApp();
  try {
    // 화면 build. 개발 때 쓰는 `deno task build`와 같은 script다.
    const built = await deno(made.dir, [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "scripts/build-ui.ts",
    ]);
    assertEquals(built.code, 0, built.stderr);
    const out = `${made.dir}/dist/screens/items`;
    const script = await Deno.readFile(`${out}/main.js`);
    assert(script.byteLength > 0);

    // blueprint 값. 앱 source의 blueprint.ts가 정본이다.
    const evaluated = await deno(made.dir, [
      "eval",
      IMPORT_MAP,
      "--allow-read",
      `import b from "file://${made.dir}/blueprint.ts"; console.log(JSON.stringify(b));`,
    ]);
    assertEquals(evaluated.code, 0, evaluated.stderr);
    const blueprint = JSON.parse(evaluated.stdout) as {
      sdk_dependencies: { name: string; version: string }[];
      problem_codes: { code: string }[];
      commands: { key: string }[];
      screens: { key: string; path: string }[];
    };

    // 앱 source를 commit한다. .gitignore가 dist·.lophn을 뺀다.
    await git(made.dir, ["init", "-q"]);
    await git(made.dir, ["config", "user.email", "dev@lophn.local"]);
    await git(made.dir, ["config", "user.name", "dev"]);
    await git(made.dir, ["add", "-A"]);
    await git(made.dir, ["commit", "-q", "-m", "init"]);
    const commit = await git(made.dir, ["rev-parse", "HEAD"]);

    const assets: { path: string; bytes: Uint8Array }[] = [];
    for await (const entry of Deno.readDir(out)) {
      if (entry.isFile && entry.name !== "main.js") {
        assets.push({
          path: `screens/items/${entry.name}`,
          bytes: await Deno.readFile(`${out}/${entry.name}`),
        });
      }
    }
    const data = `${made.parent}/data`;
    await Deno.mkdir(data);
    const uiNames = new Set([
      "@lophn/blueprint",
      "@lophn/design",
      "@lophn/wording",
      "@lophn/ui-control",
      "@lophn/ui-layout",
      "@lophn/ui-state",
    ]);
    const prepared = await prepareRelease({
      dataRoot: data,
      app: APP,
      sourceRoot: made.dir,
      commit,
      entrypoint: "main.ts",
      blueprintSource: evaluated.stdout,
      screens: [{ path: "screens/items/main.js", bytes: script }],
      assets,
      sdkDependencies: blueprint.sdk_dependencies,
      uiDependencies: [
        ...blueprint.sdk_dependencies.filter((item) => uiNames.has(item.name)),
        { name: "react", version: "19.3.0" },
        { name: "react-dom", version: "19.3.0" },
      ],
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    const sealed = await verifySealedPermissions(prepared.value.copyPath);
    assert(sealed.ok, sealed.ok ? "" : sealed.error.message);

    // bundle에는 진입 코드·blueprint·lock과 build한 화면이 있고 manifest가 고정 SDK 의존을 가진다.
    const manifest = JSON.parse(
      await Deno.readTextFile(`${prepared.value.copyPath}/manifest.json`),
    ) as {
      entrypoint: string;
      files: { path: string }[];
      sdk_dependencies: { name: string; version: string }[];
    };
    assertEquals(manifest.entrypoint, "main.ts");
    assertEquals(manifest.sdk_dependencies, blueprint.sdk_dependencies);
    const paths = manifest.files.map((file) => file.path);
    for (
      const path of [
        "main.ts",
        "deno.lock",
        "blueprint.json",
        "migrations/0-1.sql",
        "screens/items/main.js",
        "screens/items/index.html",
        "screens/items/main.css",
      ]
    ) assert(paths.includes(path), `${path} is not in the bundle`);

    // 실제 앱 진입점이 쓰는 화면 읽기가 bundle 사본의 screens/에서 내준다(shell#T37).
    const files = bundleScreenFiles(prepared.value.copyPath);
    const index = files.screenBytes("items", "index.html");
    assert(index);
    assertEquals(
      new TextDecoder().decode(index).includes('src="./main.js"'),
      true,
    );
    assertEquals(files.contentType("index.html"), "text/html; charset=utf-8");
    assert(files.screenBytes("items", "main.js"));
    assert(files.screenBytes("items", "main.css"));
    assertEquals(
      screenContentType(
        assets.find((asset) => asset.path.endsWith(".woff2"))!.path,
      ),
      "font/woff2",
    );
    // blueprint의 screen path는 그 화면의 진입 자원이다.
    assertEquals(blueprint.screens[0].path, "/screens/items/index.html");

    // problems app test의 선언 검사. 고정 SDK·선언 code의 실패 경로·source의 code 사용이 모두 맞다.
    const failureTest = await sha256Hex("failure_path:store_unavailable");
    const plan = generateAppTestChecks({
      bundle_hash: prepared.value.bundleHash,
      test_hash: failureTest,
      blueprint: blueprint as never,
      // 템플릿 앱은 migrations/0-1.sql 하나이고 이전 release가 없다(apps/data#R3).
      data: { schema: 1, previous_schema: null },
      blueprint_hash: prepared.value.blueprintHash,
      frozen: {
        blueprint: prepared.value.blueprintHash,
        sdk_dependencies: sdkDependenciesHash(blueprint.sdk_dependencies),
        failure_paths: blueprint.problem_codes.map((item) => ({
          code: item.code,
          test_hash: failureTest,
        })),
      },
      fixed_sdk: blueprint.sdk_dependencies,
      previous_declarations: null,
    });
    const precomputed = plan.checks.filter((check) => check.precomputed);
    assertEquals(
      precomputed.map((check) => check.name).sort(),
      ["declarations", "failure_path_coverage", "fixed_sdk"],
    );
    for (const check of precomputed) {
      assertEquals(
        check.precomputed?.status,
        "pass",
        check.precomputed?.reason,
      );
    }
    // 화면이 있어 화면 예외·feedback 검사가 필수다.
    assert(plan.harness.has_view);
    const usage = scanCodeUsage(await loadSources(made.dir));
    assertEquals(
      [...new Set(usage.literals.map((use) => use.code))],
      blueprint.problem_codes.map((item) => item.code),
    );
    assertEquals(usage.dynamic, []);
  } finally {
    await made.dispose();
  }
});
