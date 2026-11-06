// main과 preload를 각각 CJS 한 파일로 묶는다.
// sandbox preload는 Node 모듈을 못 읽으므로 electron 말고는 아무것도 묶인 채 남기면 안 된다.
// 저장소의 .ts 원본이 import한 zod는 root npm workspace의 node_modules에서 찾는다.
// package.json의 "type": "module"이 .js를 ESM으로 읽으므로 출력은 .cjs로 낸다.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const shell = dirname(here);
const root = join(here, "../../..");

type BuildEntry = { in: string; out: string };

const shared = {
  bundle: true,
  platform: "node" as const,
  format: "cjs" as const,
  outExtension: { ".js": ".cjs" },
  external: ["electron", "node-pty"],
  nodePaths: [join(root, "node_modules")],
  // 저장소 패키지는 @lophn/<name> workspace 이름을 esbuild가 모르므로 여기서 직접 푼다.
  plugins: [lophnPackages(root)],
};

/** `@lophn/<name>`를 `packages/<name>/mod.ts`로 푼다. 하위 경로는 그 패키지 안의 파일이다. */
function lophnPackages(repoRoot: string): esbuild.Plugin {
  return {
    name: "lophn-packages",
    setup(build) {
      build.onResolve({ filter: /^@lophn\// }, (args) => {
        const rest = args.path.slice("@lophn/".length);
        const slash = rest.indexOf("/");
        const name = slash < 0 ? rest : rest.slice(0, slash);
        const sub = slash < 0 ? "mod.ts" : rest.slice(slash + 1);
        const file = sub.endsWith(".ts") ? sub : `${sub}.ts`;
        return { path: join(repoRoot, "packages", name, file) };
      });
    },
  };
}

const entries: BuildEntry[] = [
  // main.cjs는 시작 flag를 보고 desktop main을 연다.
  { in: join(here, "entry.ts"), out: "main" },
  { in: join(here, "desktop/main.ts"), out: "desktop" },
  { in: join(shell, "terminal-host/cli.ts"), out: "terminal-host" },
  { in: join(shell, "preload/shell.ts"), out: "preload-shell" },
  {
    in: join(shell, "preload/secret-input.ts"),
    out: "preload-secret-input",
  },
  { in: join(shell, "preload/app.ts"), out: "preload-app" },
  { in: join(shell, "preload/artifact.ts"), out: "preload-artifact" },
];

function build(outdir: string, extra: BuildEntry[] = []): Promise<void> {
  return esbuild
    .build({ ...shared, entryPoints: [...entries, ...extra], outdir })
    .then(() => {});
}

// 본체 안 extension의 entry는 shell main bundle과 따로 CJS 한 파일로 묶는다. registry가 manifest의 `entry`로 require한다.
const bundledExtensions = join(here, "extensions/bundled");
const extensionEntries = [
  join(bundledExtensions, "harness/index.ts"),
  join(bundledExtensions, "harness-gui/index.ts"),
];

// manifest 판이 제품 판과 다르면 registry가 incompatible로 두어 extension이 말없이 멈춘다. 빌드에서 막는다.
function checkExtensionVersions(): void {
  const product = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  for (const entry of extensionEntries) {
    const manifestPath = join(dirname(entry), "manifest.json");
    const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
    if (version !== product) {
      throw new Error(
        `${manifestPath} version ${version} differs from the product version ${product}; bump it with package.json`,
      );
    }
  }
}

function buildExtensions(): Promise<void> {
  checkExtensionVersions();
  return Promise.all(
    extensionEntries.map((entry) =>
      esbuild.build({
        ...shared,
        entryPoints: [entry],
        outdir: join(dirname(entry), "dist"),
        // Agent SDK는 모듈 맨 위에서 import.meta.url로 createRequire를 부른다. CJS 묶음에는 이 값이 없어 로드가 깨진다.
        define: { "import.meta.url": "__importMetaUrl" },
        banner: {
          js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;',
        },
      }),
    ),
  ).then(() => {});
}

// node-pty 1.1.0은 macOS·Windows의 N-API prebuild를 싣고 Linux만 없다. Linux에서만 source로 compile한다.
function rebuildNodePty(): number {
  if (process.platform !== "linux") return 0;
  return (
    spawnSync(
      process.execPath,
      [
        join(root, "node_modules/@electron/rebuild/lib/cli.js"),
        "-f",
        "-m",
        join(root, "node_modules/node-pty"),
      ],
      { cwd: here, stdio: "inherit" },
    ).status ?? 1
  );
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const rebuilt = rebuildNodePty();
  if (rebuilt !== 0) process.exit(rebuilt);
  // postinstall과 `npm run rebuild`는 rebuild만 한다.
  if (process.argv[2] !== "rebuild") {
    await build(join(here, "dist"));
    await buildExtensions();
  }
}
