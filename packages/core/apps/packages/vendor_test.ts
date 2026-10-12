// 설치 사본의 자기 완결(apps/sdk#R9, R10, R34)과 지원 소스(shell#T40·T41). 설치 사본은 저장소의 packages/ 없이
// 앱 bundle 안에서 읽히므로 packages/sdk 밖의 소스를 쓰는 자리는 사본 안 vendor/로 담긴다.
import { assert, assertEquals } from "@std/assert";
import {
  installPackage,
  installSupportPackage,
  verifyInstallPermissions,
} from "./install.ts";
import { relativeSpecifier, rewriteSpecifiers } from "./vendor.ts";
import { removeTree } from "./testing/mod.ts";

const guide = new TextEncoder().encode("# guide\n");

async function install(home: string, name: string) {
  const installed = await installPackage(
    name,
    "installed for the self-contained test",
    "component",
    "1.0.0",
    guide,
    { dataRoot: home },
  );
  assert(installed.ok, installed.ok ? "" : installed.error.message);
  return installed.value;
}

async function sources(directory: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      found.push(...await sources(`${directory}/${entry.name}`, path));
    } else found.push(path);
  }
  return found.sort();
}

Deno.test("apps/sdk#R9: 사본 안 specifier는 파일 위치 기준 상대 경로로 바뀐다", () => {
  assertEquals(relativeSpecifier("mod.ts", "vendor/a/b.ts"), "./vendor/a/b.ts");
  assertEquals(
    relativeSpecifier("x/y/mod.ts", "vendor/a/b.ts"),
    "../../vendor/a/b.ts",
  );
  assertEquals(relativeSpecifier("vendor/a/c.ts", "vendor/a/b.ts"), "./b.ts");
  const rewritten = rewriteSpecifiers(
    {
      path: "x/mod.ts",
      bytes: new TextEncoder().encode(
        'import a from "../../protocol/a.ts";\nconst s = "../../protocol/b.ts";\n',
      ),
    },
    { "../../protocol/a.ts": "vendor/a.ts" },
  );
  assertEquals(
    new TextDecoder().decode(rewritten.bytes),
    'import a from "../vendor/a.ts";\nconst s = "../../protocol/b.ts";\n',
  );
  // 소스가 아닌 파일은 바꾸지 않는다.
  const markdown = {
    path: "guide.md",
    bytes: new TextEncoder().encode('"../../protocol/a.ts"'),
  };
  assertEquals(
    rewriteSpecifiers(markdown, { "../../protocol/a.ts": "vendor/a.ts" }),
    markdown,
  );
});

Deno.test("apps/sdk#R9 apps/sdk#R10: blueprint와 cap-problem 사본은 packages 밖을 가리키지 않고 저장소 없이 실행된다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-vendor-" });
  try {
    const blueprint = await install(home, "@lophn/blueprint");
    const problem = await install(home, "@lophn/cap-problem");
    for (const copy of [blueprint, problem]) {
      for (const path of await sources(copy.install_path)) {
        if (!/\.(?:ts|tsx)$/.test(path)) continue;
        const text = await Deno.readTextFile(`${copy.install_path}/${path}`);
        // 시험 파일은 사본 안에 있어도 앱이 불러오지 않는다.
        if (/_test\.tsx?$/.test(path)) continue;
        assert(!text.includes("../../protocol/"), `${path} leaves the copy`);
        assert(
          !text.includes("@lophn/protocol"),
          `${path} needs the workspace`,
        );
      }
    }
    assert(
      blueprint.files.includes("vendor/protocol/apps/blueprint-value.ts"),
    );
    assert(problem.files.includes("vendor/protocol/problems/sdk-report.ts"));
    assert(problem.files.includes("vendor/base/mod.ts"));
    // 깊은 폴더의 중간 폴더까지 읽기 전용이다.
    for (const copy of [blueprint, problem]) {
      const permissions = await verifyInstallPermissions(copy.install_path);
      assert(permissions.ok, permissions.ok ? "" : permissions.error.message);
    }
    const nested = await Deno.stat(
      `${blueprint.install_path}/vendor/protocol`,
    );
    assertEquals((nested.mode ?? 0) & 0o222, 0);

    // 설정·import map·workspace 없이 사본만으로 불러와 쓴다.
    const run = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        "--no-config",
        "--no-remote",
        "--no-npm",
        "--allow-read",
        `const b = await import("file://${blueprint.install_path}/mod.ts");\n` +
        `const p = await import("file://${problem.install_path}/mod.ts");\n` +
        `console.log(typeof b.defineBlueprint, typeof p.reportProblem, typeof p.createProblemReporter);`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      new TextDecoder().decode(run.stdout).trim(),
      "function function function",
      new TextDecoder().decode(run.stderr),
    );
  } finally {
    await removeTree(home);
  }
});

Deno.test("apps/sdk#R13 apps/sdk#R9: 지원 소스는 시험·다른 Package를 빼고 읽기 전용으로 풀리며 다시 풀어도 같다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-support-" });
  try {
    const design = await installSupportPackage("@lophn/design", {
      dataRoot: home,
    });
    const wording = await installSupportPackage("@lophn/wording", {
      dataRoot: home,
    });
    assert(design.ok && wording.ok);
    assertEquals(design.value.install_path, `${home}/sdk/design/1.0.0`);
    assertEquals(wording.value.install_path, `${home}/sdk/wording/1.0.0`);
    // 공용 UI가 읽는 진입과 token·글꼴, wording의 검사·생성 도구가 있다.
    for (
      const path of [
        "mod.ts",
        "components/mod.ts",
        "reading/mod.ts",
        "base.css",
        "generated/tokens.css",
        "fonts/PretendardVariable.woff2",
      ]
    ) assert(design.value.files.includes(path), `design has no ${path}`);
    for (const path of ["mod.ts", "check.ts", "generate.ts"]) {
      assert(wording.value.files.includes(path), `wording has no ${path}`);
    }
    // 시험·fixture·wording(별도 Package)은 design 사본에 없다.
    assert(!design.value.files.some((path) => /_test\.tsx?$/.test(path)));
    assert(!design.value.files.some((path) => path.startsWith("wording/")));
    assert(
      !wording.value.files.some((path) => /_test\.tsx?$|testdata/.test(path)),
    );
    for (const copy of [design.value, wording.value]) {
      const permissions = await verifyInstallPermissions(copy.install_path);
      assert(permissions.ok, permissions.ok ? "" : permissions.error.message);
    }
    // 같은 byte를 다시 풀면 읽기 전용 사본을 건드리지 않고 같은 hash를 낸다.
    const again = await installSupportPackage("@lophn/design", {
      dataRoot: home,
    });
    assert(again.ok);
    assertEquals(again.value.bundle_hash, design.value.bundle_hash);
    // catalog 이름이 아닌 것은 지원 소스로도 받지 않는다.
    const refused = await installSupportPackage("@lophn/ui-state", {
      dataRoot: home,
    });
    assertEquals(refused.ok, false);
    if (!refused.ok) assertEquals(refused.error.code, "forbidden");
  } finally {
    await removeTree(home);
  }
});
