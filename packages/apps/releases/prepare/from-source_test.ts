// source commit에서 봉인 bundle까지(apps/releases#R1, R4, R19, apps/sdk#R7, R10, R34). 템플릿으로 만든
// 앱을 실제 git repository에 commit하고 설치 SDK 사본·화면 build·blueprint 평가를 지나 bundle이 된다.
// 사람 데이터 root는 열지 않고 temp lophn home만 쓴다.
import { assert, assertEquals } from "@std/assert";
import {
  installedHome,
  removeTree,
  scaffoldInto,
} from "../../sdk/testing/mod.ts";
import { verifySealedPermissions } from "../bundle/seal.ts";
import { prepareFromSource } from "./from-source.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";

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

async function committedApp() {
  const installed = await installedHome();
  const source = await Deno.makeTempDir({ prefix: "lophn-release-source-" });
  const dir = `${source}/app`;
  await scaffoldInto(installed, dir);
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "dev@lophn.local"]);
  await git(dir, ["config", "user.name", "dev"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "init"]);
  const commit = await git(dir, ["rev-parse", "HEAD"]);
  return {
    installed,
    dir,
    commit,
    async dispose() {
      await removeTree(source);
      await installed.dispose();
    },
  };
}

Deno.test("apps/sdk#R10 apps/releases#R1: source commit의 준비는 설치 SDK 사본·잠근 import map·build한 화면을 bundle에 담는다", async () => {
  const made = await committedApp();
  try {
    const prepared = await prepareFromSource({
      dataRoot: made.installed.home,
      app: APP,
      sourceRoot: made.dir,
      commit: made.commit,
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    const sealed = await verifySealedPermissions(prepared.value.copyPath);
    assert(sealed.ok, sealed.ok ? "" : sealed.error.message);
    const copy = prepared.value.copyPath;
    const paths = prepared.value.manifest.files.map((file) => file.path);
    for (
      const path of [
        "main.ts",
        "deno.lock",
        "import-map.json",
        "screens/items/main.js",
        "screens/items/index.html",
        "sdk/blueprint/1.0.0/mod.ts",
        "sdk/design/1.0.0/mod.ts",
      ]
    ) assert(paths.includes(path), `${path} is not in the bundle`);
    // 잠근 import map은 bundle 안 상대 경로뿐이고 범위 version·원격 값이 없다.
    const map = JSON.parse(
      await Deno.readTextFile(`${copy}/import-map.json`),
    ) as { imports: Record<string, string> };
    assertEquals(
      map.imports["@lophn/blueprint"],
      "./sdk/blueprint/1.0.0/mod.ts",
    );
    for (const value of Object.values(map.imports)) {
      assert(!value.startsWith("lophn-sdk:"), value);
      assert(!/[~^]|https?:/.test(value), value);
    }
    // 잠근 경로가 가리키는 사본이 실제로 bundle에 있다.
    for (const value of Object.values(map.imports)) {
      if (value.startsWith("./sdk/")) {
        assert(paths.includes(value.slice(2)), `${value} is not copied`);
      }
    }
    // staging은 끝나면 남지 않는다.
    const left = await Deno.stat(`${made.installed.home}/apps/${APP}/staging`)
      .then(() => true, () => false);
    assertEquals(left, false);
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/releases#R19: 취소된 준비는 bundle 사본과 staging을 남기지 않는다", async () => {
  const made = await committedApp();
  try {
    const controller = new AbortController();
    controller.abort();
    const prepared = await prepareFromSource({
      dataRoot: made.installed.home,
      app: APP,
      sourceRoot: made.dir,
      commit: made.commit,
    }, { signal: controller.signal });
    assert(!prepared.ok);
    assertEquals(prepared.error.reason, "cancelled");
    for (const name of ["staging", "bundles"]) {
      const left = await Deno.stat(
        `${made.installed.home}/apps/${APP}/${name}`,
      ).then(() => true, () => false);
      assertEquals(left, false);
    }
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/sdk#R7: 범위 version 의존이나 설치 안 된 SDK가 있는 앱은 준비를 거절한다", async () => {
  const made = await committedApp();
  try {
    const config = JSON.parse(
      await Deno.readTextFile(`${made.dir}/deno.json`),
    ) as { imports: Record<string, string> };
    config.imports["@lophn/blueprint"] =
      "lophn-sdk:@lophn/blueprint@^1.0.0/mod.ts";
    await Deno.writeTextFile(`${made.dir}/deno.json`, JSON.stringify(config));
    await git(made.dir, ["commit", "-qam", "range"]);
    const range = await prepareFromSource({
      dataRoot: made.installed.home,
      app: APP,
      sourceRoot: made.dir,
      commit: await git(made.dir, ["rev-parse", "HEAD"]),
    });
    assert(!range.ok);
    assertEquals(range.error.reason, "range_version");
    config.imports["@lophn/blueprint"] =
      "lophn-sdk:@lophn/blueprint@9.9.9/mod.ts";
    await Deno.writeTextFile(`${made.dir}/deno.json`, JSON.stringify(config));
    await git(made.dir, ["commit", "-qam", "missing"]);
    const missing = await prepareFromSource({
      dataRoot: made.installed.home,
      app: APP,
      sourceRoot: made.dir,
      commit: await git(made.dir, ["rev-parse", "HEAD"]),
    });
    assert(!missing.ok);
    assertEquals(missing.error.reason, "sdk_not_installed");
  } finally {
    await made.dispose();
  }
});

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true, () => false);
}

Deno.test("apps/releases#R3: 앱이 쓴 build script는 준비 중 실행되지 않아 process 실행·환경 읽기·staging 밖 쓰기를 하지 못하고 일반 준비는 그대로 된다", async () => {
  const made = await committedApp();
  const outside = await Deno.makeTempDir({ prefix: "lophn-escape-" });
  try {
    await Deno.writeTextFile(
      `${made.dir}/scripts/build-ui.ts`,
      [
        `await Deno.writeTextFile(${
          JSON.stringify(`${outside}/script-write`)
        }, "x");`,
        `new Deno.Command("sh", { args: ["-c", ${
          JSON.stringify(`touch ${outside}/script-spawn`)
        }] }).outputSync();`,
        `await Deno.writeTextFile(${
          JSON.stringify(`${outside}/script-env`)
        }, Deno.env.get("HOME") ?? "");`,
      ].join("\n"),
    );
    // 화면 코드가 같은 일을 하려 해도 build는 번들할 뿐 실행하지 않는다.
    const screen = `${made.dir}/src/screens/items/main.tsx`;
    await Deno.writeTextFile(
      screen,
      `new Deno.Command("sh", { args: ["-c", ${
        JSON.stringify(`touch ${outside}/screen-spawn`)
      }] }).outputSync();\n` + await Deno.readTextFile(screen),
    );
    await git(made.dir, ["add", "-A"]);
    await git(made.dir, ["commit", "-qm", "hostile build"]);
    const prepared = await prepareFromSource({
      dataRoot: made.installed.home,
      app: APP,
      sourceRoot: made.dir,
      commit: await git(made.dir, ["rev-parse", "HEAD"]),
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    for (
      const name of [
        "script-write",
        "script-spawn",
        "script-env",
        "screen-spawn",
      ]
    ) {
      assertEquals(await exists(`${outside}/${name}`), false, name);
    }
    // 앱의 build script는 bundle의 소스로만 남고 build 결과는 신뢰된 build가 만든 것이다.
    assert(
      prepared.value.manifest.files.some((file) =>
        file.path === "screens/items/main.js"
      ),
    );
  } finally {
    await removeTree(outside);
    await made.dispose();
  }
});

Deno.test("apps/releases#R3: 준비 중 실행되는 blueprint 평가는 process 실행·환경 읽기·network·staging 밖 쓰기가 막히고 준비가 실패한다", async () => {
  const made = await committedApp();
  const outside = await Deno.makeTempDir({ prefix: "lophn-escape-" });
  try {
    const attempts: Record<string, string> = {
      spawn: `new Deno.Command("sh", { args: ["-c", ${
        JSON.stringify(`touch ${outside}/spawn`)
      }] }).outputSync();`,
      env: `Deno.env.get("HOME");`,
      write: `Deno.writeTextFileSync(${
        JSON.stringify(`${outside}/write`)
      }, "x");`,
      net: `await fetch("http://127.0.0.1:9/");`,
    };
    const original = await Deno.readTextFile(`${made.dir}/blueprint.ts`);
    for (const [name, code] of Object.entries(attempts)) {
      await Deno.writeTextFile(
        `${made.dir}/blueprint.ts`,
        `${code}\n${original}`,
      );
      await git(made.dir, ["commit", "-qam", `attempt ${name}`]);
      const prepared = await prepareFromSource({
        dataRoot: made.installed.home,
        app: APP,
        sourceRoot: made.dir,
        commit: await git(made.dir, ["rev-parse", "HEAD"]),
      });
      assert(!prepared.ok, `${name} was allowed`);
      assertEquals(prepared.error.reason, "blueprint_eval_failed", name);
    }
    for (const name of ["spawn", "write"]) {
      assertEquals(await exists(`${outside}/${name}`), false, name);
    }
  } finally {
    await removeTree(outside);
    await made.dispose();
  }
});

Deno.test("apps/releases#R3: 화면 코드가 staging·설치 SDK·Deno 캐시 밖의 파일(절대 경로·`../`·symlink)을 불러오면 준비가 실패하고 내용은 어느 출력에도 없다", async () => {
  const made = await committedApp();
  const outside = await Deno.makeTempDir({ prefix: "lophn-outside-" });
  const MARK = "OUTSIDE-SECRET-MARKER";
  try {
    await Deno.writeTextFile(
      `${outside}/secret.ts`,
      `export const leaked = "${MARK}";\n`,
    );
    const screen = `${made.dir}/src/screens/items/main.tsx`;
    const original = await Deno.readTextFile(screen);
    const specifiers: Record<string, string> = {
      absolute: `${outside}/secret.ts`,
      escape: `${"../".repeat(40)}${outside.slice(1)}/secret.ts`,
    };
    for (const [name, specifier] of Object.entries(specifiers)) {
      await Deno.writeTextFile(
        screen,
        `import { leaked } from ${
          JSON.stringify(specifier)
        };\nconsole.log(leaked);\n${original}`,
      );
      await git(made.dir, ["commit", "-qam", `import ${name}`]);
      const prepared = await prepareFromSource({
        dataRoot: made.installed.home,
        app: APP,
        sourceRoot: made.dir,
        commit: await git(made.dir, ["rev-parse", "HEAD"]),
      });
      assert(!prepared.ok, `${name} import was allowed`);
      assertEquals(prepared.error.reason, "ui_build_failed", name);
    }
    // commit 안 symlink는 추출 단계에서 거절이고 가리키는 파일은 읽히지 않는다.
    await Deno.writeTextFile(screen, original);
    await Deno.symlink(`${outside}/secret.ts`, `${made.dir}/src/leak.ts`);
    await Deno.writeTextFile(
      screen,
      `import { leaked } from "../../leak.ts";\nconsole.log(leaked);\n${original}`,
    );
    await git(made.dir, ["add", "-A"]);
    await git(made.dir, ["commit", "-qm", "import symlink"]);
    const linked = await prepareFromSource({
      dataRoot: made.installed.home,
      app: APP,
      sourceRoot: made.dir,
      commit: await git(made.dir, ["rev-parse", "HEAD"]),
    });
    assert(!linked.ok, "symlink import was allowed");
    // 내용이 data root 어디에도 남지 않았다.
    const grep = await new Deno.Command("grep", {
      args: ["-rl", MARK, `${made.installed.home}/apps`],
      stdout: "piped",
      stderr: "null",
    }).output();
    assertEquals(new TextDecoder().decode(grep.stdout).trim(), "");
  } finally {
    await removeTree(outside);
    await made.dispose();
  }
});
