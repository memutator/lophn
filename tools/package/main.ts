// 설치 묶음을 만든다. 서명은 하지 않는다.
//
//   node tools/package/main.ts [--target linux|mac|win] [--dir] [--out <dir>]
//
// `--target`이 없으면 지금 OS. `--dir`은 설치 묶음(.deb·dmg·nsis) 없이 풀린 앱까지만 만든다(CI가 쓴다).
// 산출물은 <out>(기본 저장소의 build/<target>)에 둔다. 이 도구는 build만 한다. Linux 설치·기동·sandbox 확인은
// tools/verify-linux-install.ts가 Ubuntu에서 하며, 그 전에는 Linux 배포를 사용 가능으로 표시하지 않는다.
//
// 세 OS 모두 같은 순서다: shell·renderer build → electron-builder `dir`(풀린 앱) → 그 안에 platform/, extensions/,
// desktop/, skills/를 넣는다 → target별로 묶는다(linux.ts, mac.ts, win.ts).
//   platform/    packages source, npm production node_modules/
//   extensions/  본체 안 extension(manifest.json과 빌드한 dist/)
//   desktop/     빌드된 desktop 화면
//   skills/      coding agent skill 배포 원본
import { type SpawnOptions, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { checklistFor, installedVersion } from "../install-checklist.ts";
import * as linux from "./linux.ts";
import * as mac from "./mac.ts";
import * as win from "./win.ts";

const TARGETS = { linux, mac, win };
type TargetName = keyof typeof TARGETS;

export type Context = {
  repo: string;
  shellMain: string;
  out: string;
  version: string;
  run: typeof run;
  write: typeof write;
  builder(args: string[]): Promise<void>;
};

const repo = fileURLToPath(new URL("../..", import.meta.url)).replace(
  /[\\/]$/,
  "",
);
const shellMain = join(repo, "packages", "shell", "main");

function option(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<void> {
  console.log(`$ ${command} ${args.join(" ")}`);
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    stdio: ["ignore", "inherit", "inherit"],
    // Windows의 npm은 .cmd라 shell이 필요하다.
    shell: process.platform === "win32" && command === "npm",
  };
  const child = spawn(command, args, spawnOptions);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  if (code !== 0) throw new Error(`${command} failed (${code})`);
}

async function write(path: string, text: string, mode: number): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
  await chmod(path, mode);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// 설치본이 띄우는 package는 core와 cli이고(cli가 coding-agent를 선언해 같이 온다), member는 그 package.json들이 선언한 @lophn 의존을 따라 정한다.
// 손으로 적은 목록은 선언과 어긋나 설치본에서 import가 풀리지 않았다.
const PLATFORM_ROOTS = ["packages/core", "packages/cli"];

async function platformMembers(): Promise<string[]> {
  const lock = JSON.parse(
    await readFile(join(repo, "package-lock.json"), "utf8"),
  );
  const packages: Record<
    string,
    { name?: string; dependencies?: Record<string, string> }
  > = lock.packages;
  const byName = new Map<string, string>();
  for (const [path, entry] of Object.entries(packages)) {
    if (path !== "" && !path.startsWith("node_modules/") && entry.name) {
      byName.set(entry.name, path);
    }
  }
  const members = new Set<string>();
  const queue = [...PLATFORM_ROOTS];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (members.has(path)) continue;
    members.add(path);
    for (const name of Object.keys(packages[path]?.dependencies ?? {})) {
      const member = byName.get(name);
      if (member) queue.push(member);
    }
  }
  return [...members].sort();
}

// Windows에서 npm은 workspace member를 절대 경로 junction으로 잇는다(`--install-links`는 workspace에 듣지 않는다).
// 설치본을 build 폴더 밖으로 옮기면 끊기므로 복사본으로 바꾼다.
async function copyLinkedMembers(modules: string) {
  const scope = join(modules, "@lophn");
  for (const name of await readdir(scope)) {
    const link = join(scope, name);
    const target = await realpath(link);
    await rm(link, { recursive: true });
    await cp(target, link, { recursive: true });
  }
}

// core와 CLI는 Node로 뜨므로 platform/ 안에서 풀리는 npm production 의존이 있어야 한다.
async function stagePlatform(bundle: string, copyMembers: boolean) {
  const platform = join(bundle, "platform");
  await cp(join(repo, "packages"), join(platform, "packages"), {
    recursive: true,
    // shell은 Electron이 따로 싣는다. mobile은 폰 앱(root workspace 밖)이라 설치본에 필요 없다. node_modules는 아래 npm ci가 새로 푼다.
    filter: (source) => {
      const rel = relative(join(repo, "packages"), source).split(sep);
      return (
        rel[0] !== "shell" &&
        rel[0] !== "mobile" &&
        !rel.includes("node_modules")
      );
    },
  });
  const root = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
  // build 도구 의존은 설치본에서 쓰지 않는다. member 의존만 남긴다.
  delete root.dependencies;
  delete root.devDependencies;
  root.workspaces = await platformMembers();
  await writeFile(
    join(platform, "package.json"),
    JSON.stringify(root, null, 2) + "\n",
  );
  await copyFile(
    join(repo, "package-lock.json"),
    join(platform, "package-lock.json"),
  );
  // 의존 install script는 설치본에 필요 없고 build 기계에서 돌릴 이유도 없다.
  await run(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: platform },
  );
  if (copyMembers) await copyLinkedMembers(join(platform, "node_modules"));
}

// 본체 안 extension은 manifest와 따로 빌드한 entry(dist/)만 간다. registry가 거기서 찾는다.
async function stageExtensions(bundle: string) {
  const bundled = join(shellMain, "extensions", "bundled");
  for (const entry of await readdir(bundled, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const from = join(bundled, entry.name);
    if (!(await exists(join(from, "manifest.json")))) continue;
    const to = join(bundle, "extensions", entry.name);
    await mkdir(to, { recursive: true });
    await copyFile(join(from, "manifest.json"), join(to, "manifest.json"));
    await cp(join(from, "dist"), join(to, "dist"), { recursive: true });
  }
}

async function stageContent(bundle: string) {
  const dist = join(repo, "packages", "shell", "renderer", "dist");
  await cp(dist, join(bundle, "desktop"), { recursive: true });
  // skill 배포 원본(coding-agent/guides). 원본이 아직 없으면 빈 폴더를 둔다.
  const skills = join(bundle, "skills");
  await mkdir(skills, { recursive: true });
  const source = join(repo, "packages", "coding-agent", "guides", "skills");
  if (await exists(source)) await cp(source, skills, { recursive: true });
}

// electron-builder에 줄 앱 폴더. shell main의 번들(dist/)에서 runtime에 풀어야 하는 것은 external인 node-pty뿐이고
// 나머지 의존(Agent SDK 포함)은 esbuild가 번들에 넣는다. workspace 안의 shell main에서 의존을 받으면 root `overrides`의 빈 package
// symlink를 builder가 보고 멈추고, SDK의 OS별 claude 사본(300MB+)도 따라 와서, 저장소 밖 폴더에 node-pty만 따로 받는다.
async function stageApp(app: string) {
  const pkg = JSON.parse(
    await readFile(join(shellMain, "package.json"), "utf8"),
  );
  await mkdir(app, { recursive: true });
  await writeFile(
    join(app, "package.json"),
    JSON.stringify(
      {
        ...pkg,
        scripts: undefined,
        dependencies: { "node-pty": pkg.dependencies["node-pty"] },
        devDependencies: { electron: pkg.devDependencies.electron },
      },
      null,
      2,
    ) + "\n",
  );
  for (const name of ["dist", "packaging", "electron-builder.yml"]) {
    await cp(join(shellMain, name), join(app, name), { recursive: true });
  }
  await run(
    "npm",
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--package-lock=false",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: app },
  );
}

async function main(): Promise<void> {
  const hostTarget: Record<string, string> = {
    linux: "linux",
    darwin: "mac",
    win32: "win",
  };
  const name = option("--target") ?? hostTarget[process.platform];
  if (name === undefined || !(name in TARGETS)) {
    throw new Error(`unknown target ${name} (linux|mac|win)`);
  }
  const target = TARGETS[name as TargetName];
  const dirOnly = process.argv.includes("--dir");
  const out = option("--out") ?? join(repo, "build", name);
  // 제품 판은 root package.json 하나다. Electron 앱에는 build 때 넣는다.
  const version: string = JSON.parse(
    await readFile(join(repo, "package.json"), "utf8"),
  ).version;
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const app = join(out, "app");
  const builderOut = join(out, "builder");
  const builder = (args: string[]) =>
    run(
      process.execPath,
      [
        join(repo, "node_modules", "electron-builder", "cli.js"),
        ...args,
        `-c.directories.output=${builderOut}`,
        `-c.extraMetadata.version=${version}`,
        // 서명·notarize는 하지 않는다.
        "-c.mac.identity=null",
        ...target.BUILDER_ARGS,
      ],
      { cwd: app, env: { CSC_IDENTITY_AUTO_DISCOVERY: "false" } },
    );

  await run(process.execPath, ["build.ts"], { cwd: shellMain });
  await run(process.execPath, ["build.ts"], {
    cwd: join(repo, "packages", "shell", "renderer"),
  });
  await stageApp(app);
  await builder(target.BUILDER_DIR);

  const unpacked = target.unpacked(builderOut);
  const bundle = target.bundle(unpacked);
  await stagePlatform(bundle, target.COPY_MEMBERS);
  await stageExtensions(bundle);
  await stageContent(bundle);
  const ctx = { repo, shellMain, out, version, run, write, builder };
  await target.stage(ctx, bundle);
  if (dirOnly) {
    console.log(`built ${unpacked}`);
  } else {
    await target.pack(ctx, unpacked);
  }
  writeInstallChecklist(out, version);
}

// build가 끝난 뒤의 덤이라 실패해도 build를 실패시키지 않는다. 깔린 판은 지금 OS 기준이다.
function writeInstallChecklist(out: string, version: string) {
  try {
    const file = join(out, "install-checklist.md");
    writeFileSync(file, checklistFor(installedVersion(), version));
    console.log(`install checklist ${file}`);
  } catch (error) {
    console.warn(`install checklist skipped: ${error}`);
  }
}

await main();
