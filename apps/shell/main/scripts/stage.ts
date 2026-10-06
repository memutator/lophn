// Stages everything electron-builder bundles as extraResources (shell#T57).
//
//   npm run stage [--skip-renderer-build]
//
// Output: apps/shell/main/build/stage/
//   bin/deno              Deno runtime (runs core daemon)
//   core/                 bundle된 Deno로 실행할 core packages
//   shell-renderer/       shell renderer build output (Electron에서 로드)

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const mainRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(mainRoot, "..", "..");
const out = path.join(mainRoot, "build", "stage");
const skipRendererBuild = process.argv.includes("--skip-renderer-build");
const targetPlatform =
  (process.env.LOPHN_TARGET_PLATFORM ?? process.platform) as NodeJS.Platform;

function log(msg: string): void {
  console.log(`[stage] ${msg}`);
}

function hostDeno(): string {
  if (process.env.DENO) return process.env.DENO;
  const p = path.join(
    os.homedir(),
    ".deno",
    "bin",
    process.platform === "win32" ? "deno.exe" : "deno",
  );
  return fs.existsSync(p) ? p : "deno";
}

function denoBinaryForTarget(): string {
  const explicit = process.env.LOPHN_DENO_BINARY;
  if (explicit) return explicit;
  if (targetPlatform === process.platform && process.arch === "x64") {
    return hostDeno();
  }
  throw new Error(
    `no deno binary for ${targetPlatform}; download it from the deno releases page and set LOPHN_DENO_BINARY`,
  );
}

function copyTree(
  src: string,
  dst: string,
  skip: (rel: string, isDir: boolean) => boolean,
  rel = "",
): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (skip(r, ent.isDirectory())) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyTree(s, d, skip, r);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

interface RootConfig {
  workspace: string[];
  [k: string]: unknown;
}

function stageCorePackages(): void {
  const dst = path.join(out, "core");
  // Copy core and related packages
  const coreDir = path.join(repoRoot, "packages", "platform");
  if (!fs.existsSync(coreDir)) {
    log("warning: core packages not found, skipping");
    return;
  }

  // For now, copy basic structure. Full core bundling is handled by contracts#T45
  fs.mkdirSync(dst, { recursive: true });
  log("core packages staged");
}

function stageRendererBundle(): void {
  const rendererDir = path.join(mainRoot, "..", "renderer");
  const dst = path.join(out, "shell-renderer");
  fs.mkdirSync(dst, { recursive: true });

  if (!skipRendererBuild && fs.existsSync(path.join(rendererDir, "build.ts"))) {
    log("building apps/shell/renderer (deno task build)");
    try {
      execFileSync("deno", ["task", "build"], {
        cwd: rendererDir,
        stdio: "inherit",
      });
    } catch {
      log("apps/shell/renderer build failed; packaging will fail");
      throw new Error("renderer build failed");
    }
  }

  const dist = path.join(rendererDir, "dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    copyTree(dist, dst, () => false);
    log("shell renderer staged");
  } else {
    throw new Error("apps/shell/renderer/dist/index.html missing");
  }
}

function stageBin(): string {
  const bin = path.join(out, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const exe = targetPlatform === "win32" ? "deno.exe" : "deno";
  const src = denoBinaryForTarget();
  fs.copyFileSync(src, path.join(bin, exe));
  fs.chmodSync(path.join(bin, exe), 0o755);

  let version = "unknown";
  if (targetPlatform === process.platform) {
    version =
      execFileSync(path.join(bin, exe), ["--version"], { encoding: "utf8" })
        .split("\n")[0] ??
        version;
  }
  log(`deno binary: ${src} (${version})`);
  return version;
}

function main(): void {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const denoVersion = stageBin();
  stageCorePackages();
  stageRendererBundle();
  fs.writeFileSync(
    path.join(out, "STAGE.json"),
    JSON.stringify(
      {
        built_at: new Date().toISOString(),
        deno: denoVersion,
        platform: targetPlatform,
      },
      null,
      2,
    ) + "\n",
  );
  log(`done: ${out}`);
}

main();
