// Linux .deb 설치 묶음을 만든다.
//
//   deno run --allow-all tools/package-linux.ts [--out <dir>] [--skip-shell-build]
//
// 산출물: <out>/lophn_<version>_amd64.deb (기본 <out>은 저장소의 build/linux).
// 이 도구는 build만 한다. 설치·기동·sandbox 실제 확인은 tools/verify-linux-install.ts가 Ubuntu에서
// 하며, 그 전에는 Linux 배포를 사용 가능으로 표시하지 않는다.
//
// 묶음 배치(/opt/lophn/):
//   lophn-desktop, chrome-sandbox(root 소유 4755), resources/  Electron(electron-builder `--linux dir`)
//   deno                       앱과 flow가 wave 3까지 쓰는 Deno binary
//   platform/                  packages source, deno.json, deno.lock, npm production node_modules/
//   desktop/                   빌드된 desktop 화면
//   skills/                    coding agent skill 배포 원본
//   sdk -> platform/packages/sdk
// /usr/bin/{lophn-desktop,lophn} launcher, 데스크톱 항목, 아이콘.
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import process from "node:process";

import {
  cliLauncher,
  DESKTOP_LAUNCHER_TARGET,
  debControl,
  desktopEntry,
  LINUX_LAUNCHERS,
  linuxInstallLayout,
  postinstScript,
  SANDBOX_MODE,
} from "../packages/base/install/linux-install.ts";
import { HOOK_STDOUT } from "../packages/protocol/coding-agent/mod.ts";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const shellMain = `${repo}/packages/shell/main`;
const layout = linuxInstallLayout();

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
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  if (code !== 0) throw new Error(`${command} failed (${code})`);
}

async function output(command: string, args: string[]): Promise<string> {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const stdout: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  if (code !== 0) throw new Error(`${command} failed`);
  return new TextDecoder().decode(Buffer.concat(stdout));
}

const copy = (from: string, to: string) => run("cp", ["-a", `${from}/.`, to]);

async function write(path: string, text: string, mode: number) {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(path, text);
  await chmod(path, mode);
}

// 설치 묶음 안의 절대 경로(/opt/lophn/...)를 build 중 pkg root 아래 경로로 바꾼다.
function inPkg(pkg: string, installed: string): string {
  return `${pkg}${installed}`;
}

async function stagePlatform(pkg: string): Promise<void> {
  const platform = inPkg(pkg, layout.platform);
  await mkdir(platform, { recursive: true });
  await run("rsync", [
    "-a",
    "--exclude=node_modules",
    "--exclude=/packages/shell",
    `${repo}/packages`,
    `${platform}/`,
  ]);
  // 앱 화면 build는 Deno가 platform/deno.json으로 module을 푼다. 묶음에 없는 member는 workspace에서 뺀다.
  const config = JSON.parse(await readFile(`${repo}/deno.json`, "utf8"));
  config.workspace = config.workspace.filter(
    (member: string) =>
      !member.startsWith("./packages/shell") && !member.startsWith("./tools/"),
  );
  for (const key of ["tasks", "fmt", "lint", "test", "exclude"]) {
    delete config[key];
  }
  config.nodeModulesDir = "manual";
  // 묶음 workspace에서 빠진 member의 항목이 root deno.lock에 남아 frozen 검사가 실패한다.
  // Deno 쪽은 앱 build 도구만 쓰므로 lock을 읽지 않는다(deno.lock은 wave 6에서 지운다).
  config.lock = false;
  await writeFile(
    `${platform}/deno.json`,
    JSON.stringify(config, null, 2) + "\n",
  );
  await copyFile(`${repo}/deno.lock`, `${platform}/deno.lock`);
  await stageNodeModules(platform);
}

// core와 CLI는 Node로 뜨므로 platform/ 안에서 풀리는 npm production 의존이 있어야 한다.
// npm workspace가 member를 상대 symlink로 잇고, 설치를 옮겨도 symlink가 설치 안을 가리킨다.
async function stageNodeModules(platform: string): Promise<void> {
  const root = JSON.parse(await readFile(`${repo}/package.json`, "utf8"));
  // build 도구 의존은 설치본에서 쓰지 않는다. member 의존만 남긴다.
  delete root.dependencies;
  delete root.devDependencies;
  root.workspaces = [
    "packages/base",
    "packages/protocol",
    "packages/core",
    "packages/coding-agent",
  ];
  await writeFile(
    `${platform}/package.json`,
    JSON.stringify(root, null, 2) + "\n",
  );
  await copyFile(`${repo}/package-lock.json`, `${platform}/package-lock.json`);
  // 의존 install script는 설치본에 필요 없고 build 기계에서 돌릴 이유도 없다.
  await run(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: platform },
  );
}

async function stageContent(pkg: string): Promise<void> {
  await copy(
    `${repo}/packages/shell/renderer/dist`,
    await ensure(inPkg(pkg, layout.desktop)),
  );
  // skill 배포 원본(coding-agent/guides). 원본이 아직 없으면 빈 폴더를 둔다.
  const skills = await ensure(inPkg(pkg, layout.skills));
  const skillSource = `${repo}/packages/coding-agent/guides/skills`;
  if (await exists(skillSource)) await copy(skillSource, skills);
  // core 기동의 sdk 설치(sdk-install.ts)는 platform/packages(sdk, design, 앱 template)를 직접 읽는다. 이 링크는 설치 확인용이다.
  await symlink("platform/packages/sdk", inPkg(pkg, layout.sdk));
}

async function ensure(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function stageSystem(pkg: string): Promise<void> {
  await mkdir(`${pkg}/usr/bin`, { recursive: true });
  await symlink(DESKTOP_LAUNCHER_TARGET, `${pkg}${LINUX_LAUNCHERS.desktop}`);
  await write(
    `${pkg}${LINUX_LAUNCHERS.cli}`,
    cliLauncher(layout, HOOK_STDOUT),
    0o755,
  );
  await write(
    `${pkg}/usr/share/applications/lophn.desktop`,
    desktopEntry(),
    0o644,
  );
  const icon = `${pkg}/usr/share/icons/hicolor/512x512/apps/lophn.png`;
  await mkdir(icon.slice(0, icon.lastIndexOf("/")), { recursive: true });
  await copyFile(`${shellMain}/packaging/icon.png`, icon);
}

async function stageDebian(pkg: string, version: string): Promise<void> {
  const installedKb = Number(
    (await output("du", ["-sk", `${pkg}/opt`, `${pkg}/usr`]))
      .trim()
      .split("\n")
      .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
  );
  const control = `${pkg}/DEBIAN`;
  await write(
    `${control}/control`,
    debControl({ version, installedSizeKb: installedKb }),
    0o644,
  );
  await write(`${control}/postinst`, postinstScript(layout), 0o755);
  const sums = await output("sh", [
    "-c",
    `cd ${pkg} && find opt usr -type f -print0 | sort -z | xargs -0 md5sum`,
  ]);
  await write(`${control}/md5sums`, sums, 0o644);
}

async function main(): Promise<void> {
  const out = option("--out") ?? `${repo}/build/linux`;
  const pkg = `${out}/pkg`;
  const version: string = JSON.parse(
    await readFile(`${shellMain}/package.json`, "utf8"),
  ).version;
  await rm(out, { recursive: true }).catch(() => undefined);
  await mkdir(pkg, { recursive: true });

  if (!process.argv.slice(2).includes("--skip-shell-build")) {
    await run("npm", ["--prefix", shellMain, "run", "build"]);
    await run("deno", ["task", "build"], {
      cwd: `${repo}/packages/shell/renderer`,
    });
    // npm workspace는 shell main의 의존을 root node_modules로 올린다. electron-builder는 app dir의
    // node_modules만 묶고 그 native module을 rebuild하므로, 여기에 production 의존을 따로 받는다.
    // --workspaces=false가 없으면 electron-builder의 production install이 root node_modules를 프루닝한다.
    await run(
      "npm",
      [
        "install",
        "--omit=dev",
        "--workspaces=false",
        "--ignore-scripts",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: shellMain },
    );
    await run(
      `${repo}/node_modules/.bin/electron-builder`,
      ["--linux", "dir"],
      { cwd: shellMain },
    );
  }

  // Electron 앱을 /opt/lophn/에 풀고 Chromium sandbox 실행 파일을 4755로 둔다.
  await copy(
    `${shellMain}/release/linux-unpacked`,
    await ensure(inPkg(pkg, layout.root)),
  );
  await chmod(inPkg(pkg, layout.chromeSandbox), SANDBOX_MODE);
  // 앱과 flow는 wave 3까지 Deno로 뜬다. core는 이 binary를 LOPHN_DENO로 받는다.
  await copyFile(
    process.env.LOPHN_DENO_BINARY ??
      execFileSync("sh", ["-c", "command -v deno"], {
        encoding: "utf8",
      }).trim(),
    inPkg(pkg, layout.deno),
  );
  await chmod(inPkg(pkg, layout.deno), 0o755);
  await stagePlatform(pkg);
  await stageContent(pkg);
  await stageSystem(pkg);
  // 그룹·기타의 쓰기 권한을 뺀다(umask와 무관하게 설치 묶음은 root만 쓴다). setuid는 그대로다.
  await run("chmod", ["-R", "go-w", pkg]);
  await stageDebian(pkg, version);

  const deb = `${out}/lophn_${version}_amd64.deb`;
  await run("dpkg-deb", ["--root-owner-group", "-Zxz", "-z4", "-b", pkg, deb]);
  console.log(`built ${deb}`);
}

await main();
