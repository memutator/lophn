// 설치 묶음의 platform/ 진입점(`PLATFORM_ENTRIES`)을 esbuild로 `platform/dist/*.mjs`에 묶는다.
// 수천 개 raw `.ts`와 순수 JS `node_modules`를 소수 `.mjs` chunk로 줄여 Windows(Defender·콜드 I/O)와
// Linux·macOS 모두에서 core·Worker·자식 프로세스·CLI의 기동 시간을 줄인다.
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PLATFORM_ENTRIES } from "../../packages/base/install/platform-entries.ts";

// esbuild는 packages/core 의존으로 root node_modules에 호이스팅돼 있다(tools/check.ts의 electron과 같은 방식).
const esbuild = createRequire(import.meta.url)("esbuild") as {
  build(options: Record<string, unknown>): Promise<unknown>;
};

// native addon, CLI binary, 동적 tool 의존은 `platform/node_modules/`에서 runtime에 푼다.
const EXTERNAL_PACKAGES = [
  "node-pty",
  "npm",
  "esbuild",
  "typescript",
  "unpdf",
  "@anthropic-ai/claude-agent-sdk",
];

// ESM bundle 안에 묶인 CJS 의존(`ws`, `picomatch`, `@xterm/*` 등)이 Node 내장 require를 부를 수 있게 한다.
const ESM_REQUIRE_BANNER =
  'import { createRequire as __lophnCreateRequire } from "node:module"; const require = __lophnCreateRequire(import.meta.url);';

export async function bundlePlatform(
  repo: string,
  platformDir: string,
): Promise<void> {
  const outdir = join(platformDir, "dist");
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const entryPoints = Object.fromEntries(
    Object.values(PLATFORM_ENTRIES).map(({ dist, source }) => [
      dist.replace(/^dist\//, "").replace(/\.mjs$/, ""),
      join(repo, source),
    ]),
  );
  await esbuild.build({
    entryPoints,
    outdir,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node24",
    outExtension: { ".js": ".mjs" },
    external: EXTERNAL_PACKAGES,
    nodePaths: [join(repo, "node_modules")],
    banner: { js: ESM_REQUIRE_BANNER },
    logLevel: "warning",
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repo = fileURLToPath(new URL("../..", import.meta.url)).replace(
    /[\\/]$/,
    "",
  );
  const target = process.argv[2] ?? repo;
  const t0 = performance.now();
  await bundlePlatform(repo, target);
  console.log(
    `bundled platform entries into ${join(target, "dist")} in ${Math.round(performance.now() - t0)}ms`,
  );
}
