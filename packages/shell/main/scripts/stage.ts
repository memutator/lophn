// Stages everything electron-builder bundles as extraResources.
//
//   npm run stage [--skip-renderer-build]
//
// Output: packages/shell/main/build/stage/
//   bin/node-pty-prebuilt/lib/binding/*/pty.node  node-pty native module
//   shell-main/dist/      main.cjs, preload.cjs (electron-builder에서 사용)
//   shell-renderer/       shell renderer build output
//   fonts/                design token 글꼴 (Pretendard Variable, JetBrains Mono)
//   core/                 platform package source (core, protocol, base)
//   STAGE.json            빌드 메타데이터

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const mainRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(mainRoot, "..", "..");
const out = path.join(mainRoot, "build", "stage");
const skipRendererBuild = process.argv.includes("--skip-renderer-build");
const targetPlatform = (process.env.LOPHN_TARGET_PLATFORM ??
  process.platform) as NodeJS.Platform;

function log(msg: string): void {
  console.log(`[stage] ${msg}`);
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
  const nodePtyPath = path.join(repoRoot, "node_modules", "node-pty-prebuilt");
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
    throw new Error("packages directory not found");
  }

  // core daemon이 돌 때 필요한 package. core는 protocol과 base만 import한다(code-map.md).
  // 없으면 조용히 건너뛰지 않고 실패한다.
  const toStage = ["core", "protocol", "base"];
  for (const pkg of toStage) {
    const srcPkg = path.join(packagesDir, pkg);
    if (!fs.existsSync(srcPkg)) {
      throw new Error(`core package missing: packages/${pkg}`);
    }
    copyTree(srcPkg, path.join(dst, pkg), (rel) => {
      // Skip tests, dist, node_modules
      return (
        rel.endsWith("_test.ts") ||
        rel.endsWith(".test.ts") ||
        rel.includes("node_modules") ||
        rel.includes("dist") ||
        rel.startsWith(".")
      );
    });
  }

  log("core packages staged");
}

function stageRendererBundle(): void {
  const rendererDir = path.join(mainRoot, "..", "renderer");
  const dst = path.join(out, "shell-renderer");
  fs.mkdirSync(dst, { recursive: true });

  if (!skipRendererBuild && fs.existsSync(path.join(rendererDir, "build.ts"))) {
    log("building packages/shell/renderer (node build.ts)");
    try {
      execFileSync(process.execPath, [path.join(rendererDir, "build.ts")], {
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

function main(): void {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
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
        platform: targetPlatform,
      },
      null,
      2,
    ) + "\n",
  );
  log(`done: ${out}`);
}

main();
