// 할 일 앱 fixture를 끝까지 돌린다(apps#T23). 앱 폴더를 temp로 복사해 두 release(schema 2: 0→1→2, schema 1: 0→1)로
// 나눈 뒤, 각각 자기 test·type 검사를 지나고, 화면이 build되고, release 준비(T6)로 bundle이 되고, problems app
// test의 선언 검사를 지나는지 본다. 앱 자기 test는 앱 폴더의 tests/에 있고 요구 번호별 확인은 거기 있다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../../../base/mod.ts";
import { prepareRelease, verifySealedPermissions } from "../../releases/mod.ts";
import {
  generateAppTestChecks,
  loadSources,
  scanCodeUsage,
  sdkDependenciesHash,
} from "../../../problems/tests/mod.ts";
import { devImportMap, readTemplateDirectory } from "../mod.ts";
import {
  APP_TEST_ARGS,
  deno,
  installedHome,
  removeTree,
} from "../testing/mod.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
const IMPORT_MAP = "--import-map=.lophn/import-map.json";
const FIXTURE =
  new URL("../../../../../fixtures/apps/todo/", import.meta.url).pathname;

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
  // release 2: migrations 0→1→2
  two: string;
  // release 1: migrations 0→1
  one: string;
  dispose(): Promise<void>;
};

// 앱 source를 두 release로 복사하고 각각에 개발용 import map을 둔다.
async function madeApp(): Promise<Made> {
  const installed = await installedHome(["@lophn/cap-fs"]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-todo-fixture-" });
  const config = JSON.parse(
    await Deno.readTextFile(`${FIXTURE}/deno.json.tmpl`),
  ) as {
    imports: Record<string, string>;
  };
  const made: Made = {
    parent,
    two: `${parent}/two`,
    one: `${parent}/one`,
    async dispose() {
      await removeTree(parent);
      await installed.dispose();
    },
  };
  // 저장소의 fixture 원본(`.tmpl`)을 앱 폴더로 푼다.
  const files = await readTemplateDirectory(FIXTURE, { stripSuffix: true });
  assert(files.ok, files.ok ? "" : files.error.message);
  for (const dir of [made.two, made.one]) {
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
  }
  // release 1에는 1→2 단계가 없다. 공개한 단계는 고치지 않고 새 단계를 더한 것이 release 2다.
  await Deno.remove(`${made.one}/migrations/1-2.sql`);
  return made;
}

Deno.test("apps/blueprint#R21 apps/data#R3 apps/data#R6: 두 release(schema 2와 schema 1)가 각자 type 검사와 앱 자기 test를 통과한다", async () => {
  const made = await madeApp();
  try {
    for (const dir of [made.two, made.one]) {
      const check = await deno(dir, [
        "check",
        IMPORT_MAP,
        "--frozen-lockfile",
        "--cached-only",
        "main.ts",
        "blueprint.ts",
        "src/screens/todos/main.tsx",
        "scripts/build-ui.ts",
        "tests/blueprint_test.ts",
        "tests/commands_test.ts",
        "tests/context_test.ts",
        "tests/declaration_test.ts",
        "tests/failure_path_test.ts",
        "tests/fs_grant_child.ts",
        "tests/todos_test.ts",
        "tests/wording_test.ts",
      ]);
      assertEquals(check.code, 0, check.stderr);
      const tests = await deno(dir, APP_TEST_ARGS);
      assertEquals(tests.code, 0, tests.stderr + tests.stdout);
      // 각 요구의 test가 모두 돈다. schema 2의 칸 test와 schema 1의 칸 거절 test는 release마다 한쪽만 돈다.
      for (
        const name of [
          "apps/blueprint#R21: add_todo는 되돌림 근거를",
          "apps/agent-context#R5:",
          "apps/permissions#R5: Markdown 내보내기는",
          "apps/connections#R1: add_to_calendar는",
          "failure_path:store_unavailable list_todos",
          "failure_path:file_unavailable export_markdown",
        ]
      ) assert(tests.stdout.includes(name), `${name} did not run`);
      const upgrade = dir === made.two
        ? "apps/data#R6:"
        : "apps/data#R3: schema 1 release";
      assert(
        new RegExp(`${upgrade}[^\\n]* \\.\\.\\. [^\\n]*ok`).test(tests.stdout),
        `${upgrade} did not run`,
      );
    }
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/permissions#R5: 쓰기만 허락한 폴더는 읽지 못하고 이름 prefix만 같은 폴더·읽기 폴더 쓰기는 거절되며, 읽기만 허락하면 내보내기가 거절된다", async () => {
  const made = await madeApp();
  try {
    const place = `${made.parent}/place`;
    const data = `${place}/data`;
    const exports = `${place}/export`;
    const imports = `${place}/import`;
    for (const dir of [data, exports, `${exports}-sibling`, imports]) {
      await Deno.mkdir(dir, { recursive: true });
    }
    await Deno.writeTextFile(`${imports}/in.md`, "- [ ] From the file\n");
    const run = async (grants: string[]) => {
      const out = await deno(made.two, [
        "run",
        "--no-prompt",
        IMPORT_MAP,
        "--frozen-lockfile",
        "--cached-only",
        `--allow-read=${data},${made.two}/migrations${grants[0]}`,
        `--allow-write=${data}${grants[1]}`,
        "tests/fs_grant_child.ts",
        data,
        exports,
        imports,
      ]);
      assertEquals(out.code, 0, out.stderr);
      return JSON.parse(out.stdout.trim().split("\n").at(-1)!) as Record<
        string,
        string
      >;
    };
    // blueprint가 선언한 대로 export 폴더는 쓰기만, import 폴더는 읽기만 허락한 앱 프로세스다.
    const granted = await run([`,${imports}`, `,${exports}`]);
    assertEquals(granted, {
      export: "ok",
      // 쓰기 grant는 읽기를 포함하지 않는다.
      readExported: "capability:forbidden:fs.read",
      // 이름 prefix만 같은 다른 폴더는 열리지 않는다.
      writeSibling: "capability:forbidden:fs.write",
      import: "ok",
      writeImport: "capability:forbidden:fs.write",
    });
    // 읽기만 허락한 앱은 내보내지 못하고 호출자에게는 필요한 permission이 거절 사유로 간다.
    const readOnly = await run([`,${imports}`, ""]);
    assertEquals(readOnly["export"], "rejected:forbidden");
    assertEquals(readOnly["import"], "ok");
    // 쓰기만 허락하고 읽기를 주지 않으면 가져오기가 거절된다.
    const writeOnly = await run(["", `,${exports}`]);
    assertEquals(writeOnly["export"], "ok");
    assertEquals(writeOnly["import"], "rejected:forbidden");
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/blueprint#R19 apps/blueprint#R21 apps/data#R3: 두 release의 화면 build → release 준비(T6) bundle → problems app test 선언 검사가 통과하고 schema 단계가 bundle에 그대로 담긴다", async () => {
  const made = await madeApp();
  try {
    // 화면 build. 두 release는 같은 화면 source라 release 2에서 한 번만 한다.
    const built = await deno(made.two, [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "scripts/build-ui.ts",
    ]);
    assertEquals(built.code, 0, built.stderr);
    const out = `${made.two}/dist/screens/todos`;
    const script = await Deno.readFile(`${out}/main.js`);
    assert(script.byteLength > 0);
    const assets: { path: string; bytes: Uint8Array }[] = [];
    for await (const entry of Deno.readDir(out)) {
      if (entry.isFile && entry.name !== "main.js") {
        assets.push({
          path: `screens/todos/${entry.name}`,
          bytes: await Deno.readFile(`${out}/${entry.name}`),
        });
      }
    }
    const uiNames = new Set([
      "@lophn/blueprint",
      "@lophn/design",
      "@lophn/wording",
      "@lophn/ui-control",
      "@lophn/ui-layout",
      "@lophn/ui-state",
    ]);
    const bundleHashes: string[] = [];

    for (
      const release of [
        { dir: made.two, schema: 2, previous: 1, steps: ["0-1", "1-2"] },
        { dir: made.one, schema: 1, previous: null, steps: ["0-1"] },
      ]
    ) {
      const evaluated = await deno(release.dir, [
        "eval",
        IMPORT_MAP,
        "--allow-read",
        `import b from "file://${release.dir}/blueprint.ts"; console.log(JSON.stringify(b));`,
      ]);
      assertEquals(evaluated.code, 0, evaluated.stderr);
      const blueprint = JSON.parse(evaluated.stdout) as {
        sdk_dependencies: { name: string; version: string }[];
        problem_codes: { code: string }[];
        commands: { key: string }[];
        screens: { key: string; path: string; sizes: string[] }[];
        permissions: { kind: string }[];
        app_connections: { commands: string[] }[];
        agent_context: { screen: string }[];
      };
      assertEquals(blueprint.screens[0].sizes, ["full", "panel"]);

      await git(release.dir, ["init", "-q"]);
      await git(release.dir, ["config", "user.email", "dev@lophn.local"]);
      await git(release.dir, ["config", "user.name", "dev"]);
      await git(release.dir, ["add", "-A"]);
      await git(release.dir, ["commit", "-q", "-m", "init"]);
      const commit = await git(release.dir, ["rev-parse", "HEAD"]);
      const data = `${release.dir}-data`;
      await Deno.mkdir(data);
      const prepared = await prepareRelease({
        dataRoot: data,
        app: APP,
        sourceRoot: release.dir,
        commit,
        entrypoint: "main.ts",
        blueprintSource: evaluated.stdout,
        screens: [{ path: "screens/todos/main.js", bytes: script }],
        assets,
        sdkDependencies: blueprint.sdk_dependencies,
        uiDependencies: [
          ...blueprint.sdk_dependencies.filter((item) =>
            uiNames.has(item.name)
          ),
          { name: "react", version: "19.3.0" },
          { name: "react-dom", version: "19.3.0" },
        ],
      });
      assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
      bundleHashes.push(prepared.value.bundleHash);
      const sealed = await verifySealedPermissions(prepared.value.copyPath);
      assert(sealed.ok, sealed.ok ? "" : sealed.error.message);

      // bundle에는 진입 코드·blueprint·lock·build한 화면과 그 release의 migration 단계 전부가 있다.
      const manifest = JSON.parse(
        await Deno.readTextFile(`${prepared.value.copyPath}/manifest.json`),
      ) as { files: { path: string }[] };
      const paths = manifest.files.map((file) => file.path);
      for (
        const path of [
          "main.ts",
          "deno.lock",
          "blueprint.json",
          "src/todos.ts",
          "screens/todos/main.js",
          "screens/todos/index.html",
          "screens/todos/main.css",
          ...release.steps.map((step) => `migrations/${step}.sql`),
        ]
      ) assert(paths.includes(path), `${path} is not in the bundle`);
      assertEquals(
        paths.filter((path) => path.startsWith("migrations/")).sort(),
        release.steps.map((step) => `migrations/${step}.sql`),
      );
      assertEquals(blueprint.screens[0].path, "/screens/todos/index.html");

      // problems app test의 선언 검사. 고정 SDK·선언 code의 실패 경로·source의 code 사용이 모두 맞다.
      const failureTest = await sha256Hex("failure_path:store_unavailable");
      const plan = generateAppTestChecks({
        bundle_hash: prepared.value.bundleHash,
        test_hash: failureTest,
        blueprint: blueprint as never,
        data: { schema: release.schema, previous_schema: release.previous },
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
      // 이 앱이 가진 기능의 검사는 필수이고, 가진 적 없는 기능의 검사만 이유 있는 not_applicable이다.
      const status = Object.fromEntries(
        plan.checks.map((check) => [check.name, check.status]),
      );
      assertEquals(status["migration_empty"], "required");
      assertEquals(
        status["migration_upgrade"],
        release.previous === null ? "not_applicable" : "required",
      );
      for (
        const name of [
          "read_contract",
          "adapter_isolation",
          "revert_restore",
          "revert_conflict",
          "revert_duplicate",
        ]
      ) assertEquals(status[name], "required", name);
      assertEquals(status["secret_grant"], "not_applicable");
      // 화면이 있어 화면 예외·feedback 검사가 필수다.
      assert(plan.harness.has_view);
      const usage = scanCodeUsage(await loadSources(release.dir));
      assertEquals(
        [...new Set(usage.literals.map((use) => use.code))].sort(),
        blueprint.problem_codes.map((item) => item.code).sort(),
      );
      assertEquals(usage.dynamic, []);
    }
    // 두 release는 같은 source에서 schema 단계만 다르고 서로 다른 bundle이다.
    assertEquals(new Set(bundleHashes).size, 2);
  } finally {
    await made.dispose();
  }
});
