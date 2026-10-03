// deno-loader 대신 asset namespace에서 CSS Modules와 CSS·font를 읽어 esbuild loader를 쓴다.
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entries = ["desktop", "overlay", "confirmation"];

function fileUrl(path: string): URL {
  return path.startsWith("file:") ? new URL(path) : pathToFileURL(path);
}

function assetPlugin(imports: Record<string, string>): esbuild.Plugin {
  return {
    name: "renderer-assets",
    setup(build) {
      build.onResolve({ filter: /\.(css|woff2)$/ }, (args) => {
        const mapped = imports[args.path];
        const url = mapped
          ? new URL(mapped)
          : args.path.startsWith("file:")
          ? new URL(args.path)
          : args.path.startsWith(".") && args.importer
          ? new URL(args.path, fileUrl(args.importer))
          : undefined;
        if (!url || url.protocol !== "file:") return undefined;
        const path = fileURLToPath(url);
        const loader: esbuild.Loader = path.endsWith(".module.css")
          ? "local-css"
          : path.endsWith(".css")
          ? "css"
          : "file";
        return { path, namespace: "renderer-asset", pluginData: { loader } };
      });
      build.onLoad(
        { filter: /.*/, namespace: "renderer-asset" },
        async (args) => ({
          contents: await readFile(args.path),
          loader: args.pluginData.loader,
          resolveDir: dirname(args.path),
        }),
      );
    },
  };
}

export async function build(outdir = join(here, "dist")): Promise<void> {
  // 없는 workspace 폴더의 탐색을 피하되 임시 map에서도 로컬 import의 기준 경로를 유지한다.
  const scratch = await mkdtemp(join(tmpdir(), "shell-renderer-map-"));
  const configPath = join(scratch, "deno.json");
  try {
    const config = JSON.parse(await readFile(join(here, "deno.json"), "utf8"));
    const imports: Record<string, string> = Object.fromEntries(
      Object.entries(config.imports as Record<string, string>).map((
        [key, value],
      ) => [
        key,
        value.startsWith(".")
          ? new URL(value, pathToFileURL(join(here, "deno.json"))).href
          : value,
      ]),
    );
    const design = new URL(
      "../../../packages/design/",
      pathToFileURL(`${here}/`),
    );
    const designConfig = JSON.parse(
      await readFile(new URL("deno.json", design), "utf8"),
    );
    for (
      const [key, value] of Object.entries(
        designConfig.exports as Record<string, string>,
      )
    ) {
      const specifier = key === "."
        ? designConfig.name
        : `${designConfig.name}/${key.slice(2)}`;
      imports[specifier] = new URL(value, design).href;
    }
    await writeFile(configPath, JSON.stringify({ imports }));
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
        assetPlugin(imports),
        // deno-loader는 자기 esbuild 타입 사본을 쓰므로 구조만 맞춘다.
        ...(denoPlugins({ configPath }) as esbuild.Plugin[]),
      ],
    });
    // 첫 창은 lophn-shell://desktop/index.html로 연다. 문구가 없는 정적 html이다.
    await mkdir(join(outdir, "desktop"), { recursive: true });
    await copyFile(
      join(here, "desktop", "index.html"),
      join(outdir, "desktop", "index.html"),
    );
  } finally {
    await rm(scratch, { recursive: true });
  }
}

if (import.meta.main) {
  await build();
}
