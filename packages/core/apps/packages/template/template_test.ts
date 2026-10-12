// 앱 템플릿(apps/sdk#R33, R35, R41)과 설치 사본의 import 해석(shell#T40·T41의 넘어온 것).
import { assert, assertEquals } from "@std/assert";
import { verifyInstallPermissions } from "../install.ts";
import {
  readTemplateDirectory,
  type TemplateFile,
  templateHash,
} from "./files.ts";
import { buildImportMap, importSpecifiers } from "./import-map.ts";
import {
  TEMPLATE_EXTRA_IMPORTS,
  TEMPLATE_HASH,
  TEMPLATE_ROOTS,
  TEMPLATE_TOOL_IMPORTS,
} from "./pin.ts";
import { resolveTemplate } from "./resolve.ts";
import { scaffoldApp } from "./scaffold.ts";
import { installTemplate } from "../install.ts";
import {
  builtinFiles,
  installedHome,
  installTemplateInto,
  removeTree,
  scaffoldInto,
} from "../testing/mod.ts";

const decoder = new TextDecoder();
const text = (file: TemplateFile | undefined) =>
  decoder.decode(file?.bytes ?? new Uint8Array());

async function writeFiles(dir: string, files: readonly TemplateFile[]) {
  for (const file of files) {
    const target = `${dir}/${file.path}`;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeFile(target, file.bytes);
  }
}

Deno.test("apps/sdk#R35: 내장 템플릿 byte는 고정 hash와 같고 hash는 파일 순서와 무관하다", async () => {
  const files = await builtinFiles();
  const hash = await templateHash(files);
  assertEquals(
    hash,
    TEMPLATE_HASH,
    `내장 템플릿이 바뀌었다. pin.ts의 TEMPLATE_HASH를 ${hash}로 바꾼다`,
  );
  assertEquals(await templateHash([...files].reverse()), hash);
  // byte 하나가 달라도 hash가 달라진다.
  const changed = files.map((file) =>
    file.path === "main.ts"
      ? { path: file.path, bytes: new TextEncoder().encode(text(file) + " ") }
      : file
  );
  assert(await templateHash(changed) !== hash);
});

Deno.test("apps/sdk#R35 apps/sdk#R9: 설치 템플릿은 고정 hash와 같은 내용만 설치하고 사본은 0444·0555다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-template-" });
  try {
    const files = await builtinFiles();
    const refused = await installTemplate(
      files.map((file) =>
        file.path === "main.ts"
          ? { path: file.path, bytes: new TextEncoder().encode("// other\n") }
          : file
      ),
      TEMPLATE_HASH,
      { dataRoot: home },
    );
    assertEquals(refused.ok, false);
    assertEquals(
      await Deno.stat(`${home}/templates/app`).then(() => true, () => false),
      false,
    );
    const installed = await installTemplate(files, TEMPLATE_HASH, {
      dataRoot: home,
    });
    assert(installed.ok, installed.ok ? "" : installed.error.message);
    assertEquals(installed.value.install_path, `${home}/templates/app`);
    const permissions = await verifyInstallPermissions(
      installed.value.install_path,
    );
    assert(permissions.ok, permissions.ok ? "" : permissions.error.message);
    // 같은 byte를 다시 설치해도 읽기 전용 사본을 다시 쓰지 않고 성공한다.
    const again = await installTemplate(files, TEMPLATE_HASH, {
      dataRoot: home,
    });
    assert(again.ok, again.ok ? "" : again.error.message);
    // 설치 사본은 내장 템플릿과 같은 byte다.
    const read = await readTemplateDirectory(installed.value.install_path);
    assert(read.ok);
    assertEquals(await templateHash(read.value), TEMPLATE_HASH);
  } finally {
    await removeTree(home);
  }
});

Deno.test("apps/sdk#R35: 템플릿은 LOPHN_APP_TEMPLATE, 설치 templates/app, 내장 순서로 고른다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-template-" });
  const override = await Deno.makeTempDir({ prefix: "lophn-override-" });
  try {
    const none = { get: (_name: string) => undefined };
    // 후보가 하나뿐이면 검증된 내장 템플릿이다.
    const builtin = await resolveTemplate({ env: none, home });
    assert(builtin.ok, builtin.ok ? "" : builtin.error.message);
    assertEquals(builtin.value.source, "builtin");
    assertEquals(builtin.value.hash, TEMPLATE_HASH);
    assertEquals(builtin.value.skipped, null);

    // 설치 템플릿이 있으면 그것을 쓴다.
    await installTemplateInto(home);
    const installed = await resolveTemplate({ env: none, home });
    assert(installed.ok, installed.ok ? "" : installed.error.message);
    assertEquals(installed.value.source, "installed");
    assertEquals(installed.value.location, `${home}/templates/app`);

    // 사람이 명시한 override는 두 후보보다 먼저다. hash는 사람의 선택이라 묻지 않는다.
    const files = await builtinFiles();
    await writeFiles(
      override,
      files.map((file) =>
        file.path === "AGENTS.md"
          ? { path: file.path, bytes: new TextEncoder().encode("# mine\n") }
          : file
      ),
    );
    const env = {
      get: (name: string) =>
        name === "LOPHN_APP_TEMPLATE" ? override : undefined,
    };
    const chosen = await resolveTemplate({ env, home });
    assert(chosen.ok, chosen.ok ? "" : chosen.error.message);
    assertEquals(chosen.value.source, "override");
    assertEquals(chosen.value.location, override);
    assert(chosen.value.hash !== TEMPLATE_HASH);

    // override가 템플릿 모양이 아니면 다른 후보로 조용히 넘어가지 않고 실패한다.
    await Deno.remove(`${override}/main.ts`);
    const broken = await resolveTemplate({ env, home });
    assertEquals(broken.ok, false);
  } finally {
    await removeTree(home);
    await removeTree(override);
  }
});

Deno.test("apps/sdk#R35: 설치 템플릿이 고정 hash와 다르면 쓰지 않고 이유를 남긴 채 내장 템플릿으로 간다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-template-" });
  try {
    await installTemplateInto(home);
    // 설치 사본을 바꾼다(읽기 전용을 풀고).
    await Deno.chmod(`${home}/templates/app`, 0o755);
    await Deno.chmod(`${home}/templates/app/main.ts`, 0o644);
    await Deno.writeTextFile(`${home}/templates/app/main.ts`, "// edited\n");
    const resolved = await resolveTemplate({
      env: { get: () => undefined },
      home,
    });
    assert(resolved.ok, resolved.ok ? "" : resolved.error.message);
    assertEquals(resolved.value.source, "builtin");
    assertEquals(resolved.value.skipped?.source, "installed");
    assert(resolved.value.skipped?.reason.includes("pinned hash"));
    // 내장 템플릿이 고정 hash와 다르면 다른 템플릿을 대신 내지 않고 실패한다.
    const mismatch = await resolveTemplate({
      env: { get: () => undefined },
      home: `${home}/empty`,
      pinnedHash: "00".repeat(32),
    });
    assertEquals(mismatch.ok, false);
  } finally {
    await removeTree(home);
  }
});

Deno.test("apps/sdk#R33: 템플릿으로 만든 앱에 진입 코드·blueprint·import map과 lock·migration·blueprint test·fixture·React 화면·안내가 있다", async () => {
  const installed = await installedHome();
  const dir = await Deno.makeTempDir({ prefix: "lophn-app-" });
  try {
    await Deno.remove(dir);
    await scaffoldInto(installed, dir, {
      app: "my-notes",
      title: "My <Notes>",
    });
    const has = async (path: string) =>
      await Deno.stat(`${dir}/${path}`).then(
        (info) => info.isFile,
        () => false,
      );
    for (
      const path of [
        "main.ts",
        "blueprint.ts",
        "deno.json",
        "deno.lock",
        "migrations/0-1.sql",
        "tests/blueprint_test.ts",
        "tests/failure_path_test.ts",
        "tests/fixtures/items.json",
        "src/screens/items/main.tsx",
        "src/screens/items/app.tsx",
        "src/wording/en.ts",
        "AGENTS.md",
        "CLAUDE.md",
        ".gitignore",
        ".lophn/import-map.json",
      ]
    ) assert(await has(path), `${path} is missing`);

    // 제목·이름이 채워지고 빈 자리 표시는 남지 않는다. html 제목은 escape한다.
    const blueprint = await Deno.readTextFile(`${dir}/blueprint.ts`);
    assert(blueprint.includes('name: "My <Notes>"'));
    assert(
      (await Deno.readTextFile(`${dir}/src/screens/items/index.html`))
        .includes("<title>My &lt;Notes&gt;</title>"),
    );
    assert(
      (await Deno.readTextFile(`${dir}/AGENTS.md`)).includes("`my-notes`"),
    );
    for (const path of ["blueprint.ts", "AGENTS.md", "deno.json"]) {
      assert(
        !/\{\{\s*(?:TITLE|APP)\s*\}\}/.test(
          await Deno.readTextFile(`${dir}/${path}`),
        ),
      );
    }
    // CLAUDE.md는 AGENTS.md 하나를 정본으로 가리키고 관리 구간 표시가 있다.
    assertEquals(await Deno.readTextFile(`${dir}/CLAUDE.md`), "@AGENTS.md\n");
    const guide = await Deno.readTextFile(`${dir}/AGENTS.md`);
    assert(guide.includes("<!-- begin lophn-managed -->"));
    assert(guide.includes("<!-- end lophn-managed -->"));
    assert(
      (await Deno.readTextFile(`${dir}/.gitignore`)).includes(".lophn/"),
    );
    // 개발용 import map은 설치 SDK 사본의 file URL을 가리키고 앱 source에는 장치 경로가 없다.
    const dev = JSON.parse(
      await Deno.readTextFile(`${dir}/.lophn/import-map.json`),
    ) as { imports: Record<string, string> };
    assertEquals(
      dev.imports["@lophn/ui-state"],
      `file://${installed.sdkRoot}/ui-state/1.0.0/mod.ts`,
    );
    assertEquals(dev.imports["@lophn/app"], `file://${dir}/main.ts`);
    assert(
      !(await Deno.readTextFile(`${dir}/deno.json`)).includes(installed.home),
    );

    // 이름·폴더가 맞지 않으면 만들지 않는다.
    const badName = await scaffoldApp({
      files: await builtinFiles(),
      dir: `${dir}-other`,
      app: "Bad Name",
    });
    assertEquals(badName.ok, false);
    const notEmpty = await scaffoldApp({
      files: await builtinFiles(),
      dir,
      app: "again",
    });
    assertEquals(notEmpty.ok, false);
  } finally {
    await removeTree(dir);
    await installed.dispose();
  }
});

Deno.test("apps/sdk#R33 apps/sdk#R34 apps/sdk#R7: 템플릿 import map은 설치 사본에서 만든 정확한 map과 같고 범위 version이 없다", async () => {
  const installed = await installedHome();
  try {
    const built = await buildImportMap({
      sdkRoot: installed.sdkRoot,
      roots: TEMPLATE_ROOTS,
      extra: TEMPLATE_EXTRA_IMPORTS,
    });
    assert(built.ok, built.ok ? "" : built.error.message);
    const files = await builtinFiles();
    const config = JSON.parse(
      text(files.find((file) => file.path === "deno.json")),
    ) as { imports: Record<string, string> };
    assertEquals(config.imports, {
      ...built.value.map.imports,
      "@lophn/app": "./main.ts",
      ...TEMPLATE_TOOL_IMPORTS,
    });
    // `lophn-sdk:`와 npm·jsr 값은 모두 정확한 version이다. ^·~·latest·범위가 없다.
    for (const [key, value] of Object.entries(config.imports)) {
      if (value.startsWith("./")) continue;
      assert(
        /^lophn-sdk:@lophn\/[a-z0-9-]+@\d+\.\d+\.\d+\//.test(value) ||
          /^(?:npm|jsr):@?[\w./-]+@\d+\.\d+\.\d+(?:\/[\w./-]+)?$/.test(value),
        `${key} is not exact: ${value}`,
      );
    }
    // blueprint가 고정한 SDK 의존은 import map이 따라간 Package와 같다.
    const blueprint = text(files.find((file) => file.path === "blueprint.ts"));
    for (const item of built.value.packages) {
      assert(
        blueprint.includes(
          `{ name: "${item.name}", version: "${item.version}" }`,
        ),
        `${item.name} is not pinned in the blueprint`,
      );
    }
    // 시험 도구 pin은 저장소 root가 쓰는 pin과 같다.
    const root = JSON.parse(
      await Deno.readTextFile(
        new URL("../../../../../deno.json", import.meta.url),
      ),
    ) as { imports: Record<string, string> };
    for (const [name, pin] of Object.entries(TEMPLATE_TOOL_IMPORTS)) {
      assertEquals(root.imports[name], pin);
    }
  } finally {
    await installed.dispose();
  }
});

Deno.test("apps/sdk#R34 apps/sdk#R7: d3와 @lophn/chart는 ui-chart를 고른 앱의 import map에만 있다", async () => {
  const installed = await installedHome(["@lophn/ui-chart"]);
  try {
    const without = await buildImportMap({
      sdkRoot: installed.sdkRoot,
      roots: TEMPLATE_ROOTS,
      extra: TEMPLATE_EXTRA_IMPORTS,
    });
    assert(without.ok, without.ok ? "" : without.error.message);
    const plain = Object.keys(without.value.map.imports);
    assertEquals(plain.filter((key) => /^(@types\/)?d3-/.test(key)), []);
    assertEquals(plain.includes("@lophn/chart"), false);
    const withChart = await buildImportMap({
      sdkRoot: installed.sdkRoot,
      roots: [...TEMPLATE_ROOTS, { name: "@lophn/ui-chart", version: "1.0.0" }],
      extra: TEMPLATE_EXTRA_IMPORTS,
    });
    assert(withChart.ok, withChart.ok ? "" : withChart.error.message);
    const imports = withChart.value.map.imports;
    assertEquals(
      imports["@lophn/chart"],
      "lophn-sdk:@lophn/chart@1.0.0/mod.ts",
    );
    assertEquals(imports["d3-scale"], "npm:d3-scale@4.0.2");
    assertEquals(imports["d3-shape"], "npm:d3-shape@3.2.0");
  } finally {
    await installed.dispose();
  }
});

// R4의 이름 가운데 packages/sdk에 소스가 있는 것. 새 Package가 들어오면 같은 시험이 그것도 덮는다.
const SDK_NAMES = [
  "blueprint",
  "tokens",
  "ui-control",
  "ui-overlay",
  "ui-layout",
  "ui-reading",
  "ui-table",
  "ui-chart",
  "ui-filter",
  "ui-stat",
  "ui-state",
  "ui-action",
  "cap-fs",
  "cap-net",
  "cap-store",
  "cap-problem",
  "cap-schedule",
  "cap-save",
  "cap-secret",
];

Deno.test("apps/sdk#R7 apps/sdk#R10 apps/sdk#R4: 설치한 모든 공개 SDK 사본의 import가 사본·지원 소스·정확한 pin 안에서 풀린다", async () => {
  const present: string[] = [];
  for (const name of SDK_NAMES) {
    const exists = await Deno.stat(
      new URL(`../../../../sdk/${name}/`, import.meta.url),
    ).then((info) => info.isDirectory, () => false);
    if (exists) present.push(`@lophn/${name}`);
  }
  const installed = await installedHome(present);
  try {
    const built = await buildImportMap({
      sdkRoot: installed.sdkRoot,
      roots: present.map((name) => ({ name, version: "1.0.0" })),
      extra: TEMPLATE_EXTRA_IMPORTS,
    });
    assert(built.ok, built.ok ? "" : built.error.message);
    const imports = built.value.map.imports;
    // 공용 UI Package가 import하는 design·wording과 blueprint(type)가 같은 판으로 풀린다.
    for (
      const name of [
        "@lophn/design",
        "@lophn/design/components",
        "@lophn/design/reading",
        "@lophn/wording",
        "@lophn/blueprint",
      ]
    ) {
      assert(
        /^lophn-sdk:@lophn\/[a-z-]+@1\.0\.0\//.test(imports[name] ?? ""),
        `${name} is not resolved`,
      );
    }
    // 어느 사본도 packages/ 저장소 안 다른 소스나 workspace 이름을 쓰지 않는다.
    for (const value of Object.values(imports)) {
      assert(!value.includes("contracts"), value);
    }
  } finally {
    await installed.dispose();
  }
});

Deno.test("apps/sdk#R29 apps/sdk#R33 apps/sdk#R36: 화면 root는 AppErrorBoundary로 감싸고 문제 보고는 선언 code literal로 하며 guide에 재사용 기준이 있다", async () => {
  const files = await builtinFiles();
  const source = (path: string) =>
    text(files.find((file) => file.path === path));
  // 화면 root: ui-state의 AppErrorBoundary가 App을 감싼다.
  const main = source("src/screens/items/main.tsx");
  assert(main.includes('import { AppErrorBoundary } from "@lophn/ui-state";'));
  assert(/<AppErrorBoundary>\s*<App \/>\s*<\/AppErrorBoundary>/.test(main));
  // 진입은 command 등록만 하고 예외 수집·보고 통로는 진입점이 설치한다. 앱이 따로 잇지 않는다.
  const entry = source("main.ts");
  assert(entry.includes("registerCommands();"));
  assert(!entry.includes("createExceptionObserver"));
  // 보고는 SDK reportProblem에 선언한 code literal을 준다. 선언한 code가 blueprint에 있다.
  const commands = source("src/commands.ts");
  assert(commands.includes('reportProblem("store_unavailable"'));
  assert(source("blueprint.ts").includes('code: "store_unavailable"'));
  // 업무 코드는 정확한 @lophn Package와 상대 import만 쓴다. 원격·npm·jsr import가 없다.
  for (const file of files) {
    if (!/\.(?:ts|tsx)$/.test(file.path)) continue;
    if (file.path.startsWith("scripts/") || file.path.startsWith("tests/")) {
      continue;
    }
    for (const specifier of importSpecifiers(text(file))) {
      assert(
        specifier.startsWith(".") || specifier.startsWith("@lophn/") ||
          ["react", "react-dom/client", "lucide-react"].includes(specifier),
        `${file.path} imports ${specifier}`,
      );
    }
  }
  // 재사용 기준은 실제 사용처 둘 이상과 앱 DB·앱 전용 prop을 앱에 남기는 것이다.
  const guide = source("AGENTS.md");
  assert(guide.includes("## 재사용 기준"));
  assert(guide.includes("둘 이상"));
  assert(guide.includes("앱 DB 구조, 앱 전용 prop"));
});
