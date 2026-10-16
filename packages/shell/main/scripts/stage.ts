// Stages everything electron-builder bundles as extraResources.
//
//   npm run stage [--skip-renderer-build]
//
// Output: packages/shell/main/build/stage/
//   bin/deno              Deno runtime (runs core daemon)
//   bin/node-pty-prebuilt/lib/binding/*/pty.node  node-pty native module
//   shell-main/dist/      main.cjs, preload.cjs (electron-builder에서 사용)
//   shell-renderer/       shell renderer build output
//   fonts/                design token 글꼴 (Pretendard Variable, JetBrains Mono)
//   core/                 Deno workspace packages
//   STAGE.json            빌드 메타데이터

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

function stageShellMain(): void {
  const src = path.join(mainRoot, "dist");
  const dst = path.join(out, "shell-main", "dist");
  if (fs.existsSync(src)) {
    copyTree(src, dst, () => false);
    log("shell main build staged");
  }
}

function stageNodePty(): void {
  const nodePtyPath = path.join(mainRoot, "node_modules", "node-pty-prebuilt");
  const dst = path.join(out, "bin", "node-pty-prebuilt");
  if (fs.existsSync(nodePtyPath)) {
    copyTree(nodePtyPath, dst, (rel) => {
      // Only copy lib/binding/* and node binding, exclude tests and docs
      const isBinding = rel.includes("lib/binding");
      return !isBinding && !rel.includes(".gyp");
    });
    log("node-pty native module staged");
  } else {
    log("warning: node-pty-prebuilt not found, skipping");
  }
}

function stageFonts(): void {
  const designDir = path.join(repoRoot, "packages", "design");
  const fontsDir = path.join(designDir, "fonts");
  const dst = path.join(out, "fonts");
  if (fs.existsSync(fontsDir)) {
    copyTree(fontsDir, dst, () => false);
    log("fonts staged");
  }
}

function stageCorePackages(): void {
  const dst = path.join(out, "core");
  const packagesDir = path.join(repoRoot, "packages");
  if (!fs.existsSync(packagesDir)) {
    log("warning: packages directory not found, skipping");
    return;
  }

  // Copy packages for Deno bundling
  const toStage = ["platform", "contracts", "base"];
  for (const pkg of toStage) {
    const srcPkg = path.join(packagesDir, pkg);
    if (fs.existsSync(srcPkg)) {
      copyTree(
        srcPkg,
        path.join(dst, pkg),
        (rel) => {
          // Skip tests, dist, node_modules
          return (
            rel.endsWith("_test.ts") ||
            rel.endsWith(".test.ts") ||
            rel.includes("node_modules") ||
            rel.includes("dist") ||
            rel.startsWith(".")
          );
        },
      );
    }
  }

  // Copy deno.json and deno.lock for dependency resolution
  const denoJson = path.join(repoRoot, "deno.json");
  const denoLock = path.join(repoRoot, "deno.lock");
  if (fs.existsSync(denoJson)) {
    fs.copyFileSync(denoJson, path.join(dst, "deno.json"));
  }
  if (fs.existsSync(denoLock)) {
    fs.copyFileSync(denoLock, path.join(dst, "deno.lock"));
  }

  log("core packages staged");
}

function stageRendererBundle(): void {
  const rendererDir = path.join(mainRoot, "..", "renderer");
  const dst = path.join(out, "shell-renderer");
  fs.mkdirSync(dst, { recursive: true });

  if (!skipRendererBuild && fs.existsSync(path.join(rendererDir, "build.ts"))) {
    log("building packages/shell/renderer (deno task build)");
    try {
      execFileSync("deno", ["task", "build"], {
        cwd: rendererDir,
        stdio: "inherit",
      });
    } catch {
      log("packages/shell/renderer build failed; packaging will fail");
      throw new Error("renderer build failed");
    }
  }

  const dist = path.join(rendererDir, "dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    copyTree(dist, dst, () => false);
    log("shell renderer staged");
  } else {
    throw new Error("packages/shell/renderer/dist/index.html missing");
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
  stageShellMain();
  stageNodePty();
  stageFonts();
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
