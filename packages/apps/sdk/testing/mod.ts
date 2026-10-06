// 템플릿 시험의 fixture(leaf 시험 전용). 설치 SDK·템플릿을 temp lophn home에 풀고 앱을 만든다.
// 제품 코드와 template/mod.ts는 이 파일을 import하지 않는다.
import { assert } from "@std/assert";
import {
  installPackage,
  installSupportPackage,
  installTemplate,
} from "../install.ts";
import { builtinTemplate, type TemplateFile } from "../template/files.ts";
import { TEMPLATE_HASH, TEMPLATE_ROOTS } from "../template/pin.ts";
import { scaffoldApp } from "../template/scaffold.ts";
import { SUPPORT_PACKAGES } from "../vendor.ts";

// 읽기 전용(0444·0555) 사본이 있는 폴더는 쓰기 권한을 돌려준 뒤에야 지운다.
export async function removeTree(path: string): Promise<void> {
  async function open(directory: string): Promise<void> {
    await Deno.chmod(directory, 0o755);
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isDirectory) await open(`${directory}/${entry.name}`);
    }
  }
  try {
    await open(path);
  } catch {
    // 이미 없다.
  }
  await Deno.remove(path, { recursive: true }).catch(() => undefined);
}

export type InstalledHome = {
  home: string;
  sdkRoot: string;
  dispose(): Promise<void>;
};

// 템플릿이 쓰는 SDK Package와 지원 소스를 설치한 lophn home이다.
export async function installedHome(
  extraPackages: readonly string[] = [],
): Promise<InstalledHome> {
  const home = await Deno.makeTempDir({ prefix: "lophn-template-" });
  const names = [
    ...TEMPLATE_ROOTS.map((root) => root.name),
    ...extraPackages,
  ];
  for (const name of new Set(names)) {
    const installed = await installPackage(
      name,
      "installed for the template test",
      "component",
      "1.0.0",
      new TextEncoder().encode("# guide\n"),
      { dataRoot: home },
    );
    assert(installed.ok, installed.ok ? "" : installed.error.message);
  }
  for (const support of SUPPORT_PACKAGES) {
    const installed = await installSupportPackage(support.name, {
      dataRoot: home,
    });
    assert(installed.ok, installed.ok ? "" : installed.error.message);
  }
  return {
    home,
    sdkRoot: `${home}/sdk`,
    dispose: () => removeTree(home),
  };
}

export async function builtinFiles(): Promise<TemplateFile[]> {
  const files = await builtinTemplate();
  assert(files.ok, files.ok ? "" : files.error.message);
  return files.value;
}

// 내장 템플릿 설치까지 마친 home이다(설치 템플릿 후보 시험).
export async function installTemplateInto(home: string): Promise<void> {
  const installed = await installTemplate(await builtinFiles(), TEMPLATE_HASH, {
    dataRoot: home,
  });
  assert(installed.ok, installed.ok ? "" : installed.error.message);
}

// 템플릿에서 앱 폴더를 만든다.
export async function scaffoldInto(
  installed: InstalledHome,
  dir: string,
  options: { app?: string; title?: string } = {},
): Promise<string> {
  const scaffolded = await scaffoldApp({
    files: await builtinFiles(),
    dir,
    app: options.app ?? "items",
    title: options.title,
    sdkRoot: installed.sdkRoot,
  });
  assert(scaffolded.ok, scaffolded.ok ? "" : scaffolded.error.message);
  return dir;
}

export type Run = { code: number; stdout: string; stderr: string };

// 만든 앱 폴더 안에서 deno를 돌린다. 앱의 test는 잠긴 lockfile과 cache만 쓴다(problems app test와 같은 방식).
export async function deno(cwd: string, args: string[]): Promise<Run> {
  const output = await new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { NO_COLOR: "1" },
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

export const APP_TEST_ARGS = [
  "test",
  "--no-prompt",
  "--import-map=.lophn/import-map.json",
  "--frozen-lockfile",
  "--cached-only",
  "--allow-read",
  "--allow-write",
  "--allow-env",
];
