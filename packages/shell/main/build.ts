// main과 preload를 각각 CJS 한 파일로 묶는다.
// sandbox preload는 Node 모듈을 못 읽으므로 electron 말고는 아무것도 묶인 채 남기면 안 된다.
// 저장소의 .ts 원본이 import한 zod는 npm 쪽 node_modules에서 찾는다.
// package.json의 "type": "module"이 .js를 ESM으로 읽으므로 출력은 .cjs로 낸다.
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shell = dirname(here);

type BuildEntry = { in: string; out: string };

const shared = {
  bundle: true,
  platform: "node" as const,
  format: "cjs" as const,
  outExtension: { ".js": ".cjs" },
  external: ["electron", "node-pty"],
  nodePaths: [join(here, "node_modules")],
  // Deno workspace 이름은 esbuild가 모른다. 저장소 패키지로 묶는다.
  plugins: [lophnPackages(join(here, "../../.."))],
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

function build(
  outdir: string,
  extra: BuildEntry[] = [],
): Promise<void> {
  return esbuild
    .build({ ...shared, entryPoints: [...entries, ...extra], outdir })
    .then(() => {});
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const { spawnSync } = await import("node:child_process");
  const rebuilt = spawnSync(
    process.execPath,
    [
      join(here, "node_modules/@electron/rebuild/lib/cli.js"),
      "-f",
      "-m",
      join(here, "node_modules/node-pty"),
    ],
    { cwd: here, stdio: "inherit" },
  );
  if (rebuilt.status !== 0) process.exit(rebuilt.status ?? 1);
  await build(join(here, "dist"));
}
