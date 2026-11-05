// macOS dmg(arm64, 서명 없음). executableName 때문에 builder가 앱 폴더도 lophn-desktop.app으로 낸다. 설치 묶음은 .app의 Contents/Resources/ 안에 둔다(process.resourcesPath).
// 배치는 packages/base/install/mac-install.ts가 정한다.
import { join } from "node:path";

import {
  MAC_CLI_LAUNCHER,
  macCliLauncher,
} from "../../packages/base/install/mac-install.ts";
import { hookStdoutRows } from "../../packages/protocol/coding-agent/mod.ts";
import type { Context } from "./main.ts";

export const BUILDER_DIR = ["--mac", "dir", "--arm64"];
// node-pty는 macOS N-API prebuild를 싣는다(rebuild가 필요 없다).
export const BUILDER_ARGS = ["-c.npmRebuild=false"];
export const COPY_MEMBERS = false;
export const unpacked = (builderOut: string) =>
  join(builderOut, "mac-arm64", "lophn-desktop.app");
export const bundle = (app: string) => join(app, "Contents", "Resources");

export async function stage(ctx: Context, resources: string): Promise<void> {
  await ctx.write(
    join(resources, MAC_CLI_LAUNCHER),
    macCliLauncher(hookStdoutRows()),
    0o755,
  );
}

export async function pack(ctx: Context, app: string): Promise<void> {
  // 이미 풀린 앱을 dmg로만 묶는다. 묶음을 넣은 뒤라 builder가 다시 풀지 않게 한다.
  await ctx.builder(["--mac", "dmg", "--arm64", "--prepackaged", app]);
}
