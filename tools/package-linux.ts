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
//   deno                       설치된 Deno binary
//   platform/                  packages source, deno.json, deno.lock, vendor/, node_modules/
//   desktop/                   빌드된 desktop 화면
//   skills/, guides/           coding agent skill, 안내 원문
//   sdk -> platform/packages/sdk
//   lophn-credential           OS keychain 전달 helper(compile binary)
// /usr/bin/{lophn-desktop,lophn,lophn-mcp} launcher, 데스크톱 항목, 아이콘.
import { checkStagedLock } from "../packages/core/install-and-update/lock-check.ts";
import {
  cliLauncher,
  CREDENTIAL_HELPER_COMPILE_FLAGS,
  debControl,
  DESKTOP_LAUNCHER_TARGET,
  desktopEntry,
  LINUX_LAUNCHERS,
  linuxInstallLayout,
  mcpLauncher,
  postinstScript,
  SANDBOX_MODE,
} from "../packages/base/install/linux-install.ts";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const shellMain = `${repo}/packages/shell/main`;
const layout = linuxInstallLayout();

function option(name: string): string | undefined {
  const index = Deno.args.indexOf(name);
  return index >= 0 ? Deno.args[index + 1] : undefined;
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<void> {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    env: options.env,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`${command} failed (${result.code})`);
}

async function output(command: string, args: string[]): Promise<string> {
  const result = await new Deno.Command(command, { args }).output();
  if (!result.success) throw new Error(`${command} failed`);
  return new TextDecoder().decode(result.stdout);
}

const copy = (from: string, to: string) => run("cp", ["-a", `${from}/.`, to]);

async function write(path: string, text: string, mode: number) {
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, text);
  await Deno.chmod(path, mode);
}

// 설치 묶음 안의 절대 경로(/opt/lophn/...)를 build 중 pkg root 아래 경로로 바꾼다.
function inPkg(pkg: string, installed: string): string {
  return `${pkg}${installed}`;
}

async function stagePlatform(pkg: string, work: string): Promise<void> {
  const platform = inPkg(pkg, layout.platform);
  await Deno.mkdir(platform, { recursive: true });
  await run("rsync", [
    "-a",
    "--exclude=node_modules",
    "--exclude=/packages/shell",
    `${repo}/packages`,
    `${platform}/`,
  ]);
  // desktop 화면 build 전용 member(packages/shell/renderer)와 개발 도구 member(tools/*)는 묶음에 없으므로 workspace에서 뺀다.
  // vendor와 node_modules를 설치 안에 두어 시작이 의존성을 받지 않는다.
  const config = JSON.parse(await Deno.readTextFile(`${repo}/deno.json`));
  config.workspace = config.workspace.filter((member: string) =>
    !member.startsWith("./packages/shell") && !member.startsWith("./tools/")
  );
  for (const key of ["tasks", "fmt", "lint", "test", "exclude"]) {
    delete config[key];
  }
  config.vendor = true;
  config.nodeModulesDir = "manual";
  await Deno.writeTextFile(
    `${platform}/deno.json`,
    JSON.stringify(config, null, 2) + "\n",
  );
  await Deno.copyFile(`${repo}/deno.lock`, `${platform}/deno.lock`);
  // 저장소 lock에서 member만 줄어든 lock으로 의존성을 받는다. 새 항목·바뀐 integrity는 막는다.
  await run(Deno.execPath(), ["install", "--frozen=false"], {
    cwd: platform,
    env: { DENO_DIR: `${work}/denodir` },
  });
  const source = JSON.parse(await Deno.readTextFile(`${repo}/deno.lock`));
  const staged = JSON.parse(await Deno.readTextFile(`${platform}/deno.lock`));
  const checked = checkStagedLock(source, staged);
  if (!checked.ok) {
    throw new Error(`staged lock differs: ${checked.changed.join(", ")}`);
  }
}

async function stageContent(pkg: string): Promise<void> {
  await copy(
    `${repo}/packages/shell/renderer/dist`,
    await ensure(inPkg(pkg, layout.desktop)),
  );
  // 안내 원문은 lophn-agent 소유 자리에서 복사한다.
  const guides = await ensure(inPkg(pkg, layout.guides));
  for await (
    const entry of Deno.readDir(
      `${repo}/packages/core/lophn-agent/roles/lophn/guides`,
    )
  ) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      await Deno.copyFile(
        `${repo}/packages/core/lophn-agent/roles/lophn/guides/${entry.name}`,
        `${guides}/${entry.name}`,
      );
    }
  }
  // skill 배포 원본(coding-agent/guides). 원본이 아직 없으면 빈 자리를 둔다.
  const skills = await ensure(inPkg(pkg, layout.skills));
  const skillSource = `${repo}/packages/coding-agent/guides/skills`;
  if (await exists(skillSource)) await copy(skillSource, skills);
  // SDK package source는 설치 도구가 platform/packages/sdk에서 읽는다.
  await Deno.symlink("platform/packages/sdk", inPkg(pkg, layout.sdk));
}

async function ensure(path: string): Promise<string> {
  await Deno.mkdir(path, { recursive: true });
  return path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function stageHelper(pkg: string): Promise<void> {
  await run(Deno.execPath(), [
    "compile",
    ...CREDENTIAL_HELPER_COMPILE_FLAGS,
    "-o",
    inPkg(pkg, layout.credentialHelper),
    `${repo}/packages/core/install-and-update/credential-helper-main.ts`,
  ]);
}

async function stageSystem(pkg: string): Promise<void> {
  await Deno.mkdir(`${pkg}/usr/bin`, { recursive: true });
  await Deno.symlink(
    DESKTOP_LAUNCHER_TARGET,
    `${pkg}${LINUX_LAUNCHERS.desktop}`,
  );
  await write(`${pkg}${LINUX_LAUNCHERS.cli}`, cliLauncher(layout), 0o755);
  await write(`${pkg}${LINUX_LAUNCHERS.mcp}`, mcpLauncher(layout), 0o755);
  await write(
    `${pkg}/usr/share/applications/lophn.desktop`,
    desktopEntry(),
    0o644,
  );
  const icon = `${pkg}/usr/share/icons/hicolor/512x512/apps/lophn.png`;
  await Deno.mkdir(icon.slice(0, icon.lastIndexOf("/")), { recursive: true });
  await Deno.copyFile(`${shellMain}/packaging/icon.png`, icon);
}

async function stageDebian(pkg: string, version: string): Promise<void> {
  const installedKb = Number(
    (await output("du", ["-sk", `${pkg}/opt`, `${pkg}/usr`]))
      .trim().split("\n").reduce(
        (sum, line) => sum + Number(line.split("\t")[0]),
        0,
      ),
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
  const work = `${out}/work`;
  const pkg = `${out}/pkg`;
  const version: string =
    JSON.parse(await Deno.readTextFile(`${shellMain}/package.json`)).version;
  await Deno.remove(out, { recursive: true }).catch(() => undefined);
  await Deno.mkdir(work, { recursive: true });

  if (!Deno.args.includes("--skip-shell-build")) {
    await run("npm", ["--prefix", shellMain, "run", "build"]);
    await run("deno", ["task", "build"], {
      cwd: `${repo}/packages/shell/renderer`,
    });
    await run(`${shellMain}/node_modules/.bin/electron-builder`, [
      "--linux",
      "dir",
    ], { cwd: shellMain });
  }

  // Electron 앱을 /opt/lophn/에 풀고 Chromium sandbox 실행 파일을 4755로 둔다.
  await copy(
    `${shellMain}/release/linux-unpacked`,
    await ensure(inPkg(pkg, layout.root)),
  );
  await Deno.chmod(inPkg(pkg, layout.chromeSandbox), SANDBOX_MODE);
  await Deno.copyFile(
    Deno.env.get("LOPHN_DENO_BINARY") ?? Deno.execPath(),
    inPkg(pkg, layout.deno),
  );
  await Deno.chmod(inPkg(pkg, layout.deno), 0o755);
  await stagePlatform(pkg, work);
  await stageContent(pkg);
  await stageHelper(pkg);
  await stageSystem(pkg);
  // 그룹·기타의 쓰기 권한을 뺀다(umask와 무관하게 설치 묶음은 root만 쓴다). setuid는 그대로다.
  await run("chmod", ["-R", "go-w", pkg]);
  await stageDebian(pkg, version);

  const deb = `${out}/lophn_${version}_amd64.deb`;
  await run("dpkg-deb", ["--root-owner-group", "-Zxz", "-z4", "-b", pkg, deb]);
  console.log(`built ${deb}`);
}

await main();
