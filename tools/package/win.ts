// Windows nsis(x64, 서명 없음). 설치 root(lophn-desktop.exe가 있는 폴더) 바로 아래에 묶음을 둔다.
// 배치는 packages/base/install/win-install.ts가 정한다.
import { join } from "node:path";

import {
  WIN_CLI_LAUNCHER,
  winCliLauncher,
} from "../../packages/base/install/win-install.ts";
import type { Context } from "./main.ts";

export const BUILDER_DIR = ["--win", "dir", "--x64"];
// node-pty는 Windows N-API prebuild를 싣는다(rebuild가 필요 없다).
export const BUILDER_ARGS = ["-c.npmRebuild=false"];
export const COPY_MEMBERS = true;
export const unpacked = (builderOut: string) =>
  join(builderOut, "win-unpacked");
export const bundle = (dir: string) => dir;

export async function stage(ctx: Context, dir: string): Promise<void> {
  await ctx.write(join(dir, WIN_CLI_LAUNCHER), winCliLauncher(), 0o755);
}

export async function pack(ctx: Context, dir: string): Promise<void> {
  await ctx.builder(["--win", "nsis", "--x64", "--prepackaged", dir]);
}
