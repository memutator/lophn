// shell·overlay·confirmation entry를 각각 브라우저 bundle 하나로 만든다.
// deno bundle은 CSS Modules의 클래스 맵을 만들지 못해 esbuild로 묶는다.
// esbuild-deno-loader는 모든 파일을 자기가 읽으므로, CSS Modules와 글꼴은 별도
// namespace에서 esbuild loader로 넘긴다. 글꼴 파일은 T4에서 더한다.
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const here = dirname(new URL(import.meta.url).pathname);

const entries = ["desktop", "overlay", "confirmation"];

const assetLoaders: Record<string, string> = {
  ".module.css": "local-css",
  ".woff2": "file",
};

function assetPlugin(): esbuild.Plugin {
  return {
    name: "renderer-assets",
    setup(build) {
      build.onResolve({ filter: /\.(module\.css|woff2)$/ }, (args) => {
        if (!args.path.startsWith(".")) return undefined;
        const path = new URL(args.path, pathToFileURL(args.importer)).pathname;
        const loader = Object.entries(assetLoaders).find(([ext]) =>
          path.endsWith(ext)
        )?.[1];
        if (!loader) return undefined;
        return { path, namespace: "renderer-asset", pluginData: { loader } };
      });
      build.onLoad(
        { filter: /.*/, namespace: "renderer-asset" },
        async (args) => ({
          contents: await readFile(args.path),
          loader: args.pluginData.loader,
        }),
      );
    },
  };
}

export async function build(outdir = join(here, "dist")): Promise<void> {
  // 루트 deno.json의 workspace 멤버 glob은 아직 없는 폴더를 가리켜 deno-loader의
  // workspace 탐색이 실패한다. renderer deno.json의 imports만 담은 import map을
  // 넘기면 탐색 없이 같은 resolve를 쓴다.
  const scratch = await mkdtemp(join(tmpdir(), "shell-renderer-map-"));
  const configPath = join(scratch, "deno.json");
  try {
    const config = JSON.parse(await readFile(join(here, "deno.json"), "utf8"));
    await writeFile(configPath, JSON.stringify({ imports: config.imports }));
    await esbuild.build({
      absWorkingDir: here,
      entryPoints: entries.map((name) => ({
        in: join(name, "entry.tsx"),
        out: name,
      })),
      outdir,
      bundle: true,
      format: "esm",
      jsx: "automatic",
      assetNames: "[name]",
      plugins: [
        assetPlugin(),
        // deno-loader는 자기 esbuild 타입 사본을 쓰므로 구조만 맞춘다.
        ...(denoPlugins({ configPath }) as esbuild.Plugin[]),
      ],
    });
  } finally {
    await rm(scratch, { recursive: true });
  }
}

if (import.meta.main) {
  await build();
}
