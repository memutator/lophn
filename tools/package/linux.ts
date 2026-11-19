// Linux .deb. 배치는 packages/base/install/linux-install.ts가 정한다(/opt/lophn/, /usr/bin/{lophn-desktop,lophn}).
// cp -a, du, md5sum, dpkg-deb는 Linux에서만 도는 단계라 이 파일에만 둔다.
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";

import {
  cliLauncher,
  DESKTOP_LAUNCHER_TARGET,
  debControl,
  desktopEntry,
  LINUX_LAUNCHERS,
  linuxInstallLayout,
  postinstScript,
  SANDBOX_MODE,
} from "../../packages/base/install/linux-install.ts";
import { hookStdoutRows } from "../../packages/protocol/coding-agent/mod.ts";
import { verifyLinuxNativeModules } from "./linux-glibc.ts";
import type { Context } from "./main.ts";

const layout = linuxInstallLayout();

export const BUILDER_DIR = ["--linux", "dir"];
// Electron은 desktopName으로 .desktop 파일과 창을 잇는다.
export const BUILDER_ARGS = ["-c.extraMetadata.desktopName=lophn.desktop"];
export const COPY_MEMBERS = false;
export const unpacked = (builderOut: string) =>
  join(builderOut, "linux-unpacked");
export const bundle = (dir: string) => dir;

// launcher는 /usr/bin에 두므로 pack에서 만든다. stage에서는 묶음 안 native module의 glibc 상한(2.35)을 검사한다.
export async function stage(_ctx: Context, bundleDir: string): Promise<void> {
  await verifyLinuxNativeModules(bundleDir);
}

async function output(command: string, args: string[]): Promise<string> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  if (code !== 0) throw new Error(`${command} failed`);
  return Buffer.concat(chunks).toString();
}

export async function pack(ctx: Context, dir: string): Promise<void> {
  const pkg = join(ctx.out, "pkg");
  // 풀린 앱을 /opt/lophn/에 두고 Chromium sandbox 실행 파일을 4755로 둔다.
  const root = join(pkg, layout.root);
  await mkdir(root, { recursive: true });
  await ctx.run("cp", ["-a", `${dir}/.`, root]);
  await chmod(join(pkg, layout.chromeSandbox), SANDBOX_MODE);
  // core 기동의 sdk 설치(sdk-install.ts)는 platform/packages(sdk, design, 앱 template)를 직접 읽는다. 이 링크는 설치 확인용이다.
  await symlink("platform/packages/sdk", join(pkg, layout.sdk));

  await mkdir(join(pkg, "usr/bin"), { recursive: true });
  await symlink(DESKTOP_LAUNCHER_TARGET, join(pkg, LINUX_LAUNCHERS.desktop));
  await ctx.write(
    join(pkg, LINUX_LAUNCHERS.cli),
    cliLauncher(layout, hookStdoutRows()),
    0o755,
  );
  await ctx.write(
    join(pkg, "usr/share/applications/lophn.desktop"),
    desktopEntry(),
    0o644,
  );
  const icon = join(pkg, "usr/share/icons/hicolor/512x512/apps/lophn.png");
  await mkdir(join(icon, ".."), { recursive: true });
  await copyFile(join(ctx.shellMain, "packaging", "icon.png"), icon);
  // 그룹·기타의 쓰기 권한을 뺀다(umask와 무관하게 설치 묶음은 root만 쓴다). setuid는 그대로다.
  await ctx.run("chmod", ["-R", "go-w", pkg]);

  const installedKb = (await output("du", ["-sk", `${pkg}/opt`, `${pkg}/usr`]))
    .trim()
    .split("\n")
    .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0);
  const control = join(pkg, "DEBIAN");
  await ctx.write(
    join(control, "control"),
    debControl({ version: ctx.version, installedSizeKb: installedKb }),
    0o644,
  );
  await ctx.write(join(control, "postinst"), postinstScript(layout), 0o755);
  const sums = await output("sh", [
    "-c",
    `cd ${pkg} && find opt usr -type f -print0 | sort -z | xargs -0 md5sum`,
  ]);
  await ctx.write(join(control, "md5sums"), sums, 0o644);

  const deb = join(ctx.out, `lophn_${ctx.version}_amd64.deb`);
  await ctx.run("dpkg-deb", [
    "--root-owner-group",
    "-Zxz",
    "-z4",
    "-b",
    pkg,
    deb,
  ]);
  console.log(`built ${deb}`);
}
