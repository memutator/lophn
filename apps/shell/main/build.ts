// main과 preload 세 개를 각각 CJS 한 파일로 묶는다.
// sandbox preload는 Node 모듈을 못 읽으므로 electron 말고는 아무것도 묶인 채 남기면 안 된다.
// 저장소의 .ts 원본이 import한 zod는 npm 쪽 node_modules에서 찾는다.
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shell = dirname(here);

export type BuildEntry = { in: string; out: string };

const shared = {
  bundle: true,
  platform: "node" as const,
  format: "cjs" as const,
  external: ["electron"],
  nodePaths: [join(here, "node_modules")],
};

const entries: BuildEntry[] = [
  { in: join(here, "desktop/main.ts"), out: "main" },
  { in: join(shell, "preload/shell.ts"), out: "preload-shell" },
  { in: join(shell, "preload/confirmation.ts"), out: "preload-confirmation" },
  { in: join(shell, "preload/app.ts"), out: "preload-app" },
];

export function build(
  outdir: string,
  extra: BuildEntry[] = [],
): Promise<void> {
  return esbuild
    .build({ ...shared, entryPoints: [...entries, ...extra], outdir })
    .then(() => {});
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await build(join(here, "dist"));
}
