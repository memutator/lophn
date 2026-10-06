// 화면 build. 개발 때 `deno task build`로 돌린다. src/screens/<key>/의 화면을 고정한 UI Package와 함께
// 묶어 dist/screens/<key>/에 index.html·main.js·main.css와 글꼴을 만든다. 운영은 build나 의존 다운로드를
// 하지 않고 release 준비가 bundle에 담은 이 결과만 읽는다(apps/sdk#R10, R34).
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const MAP = join(root, ".lophn/import-map.json");

// CSS Modules·CSS·글꼴은 import map이 가리키는 설치 사본의 파일을 esbuild loader로 읽는다.
function assets(imports: Record<string, string>): esbuild.Plugin {
  return {
    name: "app-assets",
    setup(build) {
      build.onResolve({ filter: /\.(css|woff2)$/ }, (args) => {
        const mapped = imports[args.path];
        const base = args.importer.startsWith("file:")
          ? args.importer
          : pathToFileURL(args.importer).href;
        const url = mapped
          ? new URL(mapped)
          : args.path.startsWith("file:")
          ? new URL(args.path)
          : args.path.startsWith(".")
          ? new URL(args.path, base)
          : undefined;
        if (!url || url.protocol !== "file:") return undefined;
        return { path: fileURLToPath(url), namespace: "app-asset" };
      });
      build.onLoad({ filter: /.*/, namespace: "app-asset" }, async (args) => ({
        contents: await readFile(args.path),
        loader: args.path.endsWith(".module.css")
          ? "local-css"
          : args.path.endsWith(".css")
          ? "css"
          : "file",
        resolveDir: dirname(args.path),
      }));
    },
  };
}

export async function build(): Promise<string[]> {
  let imports: Record<string, string>;
  try {
    imports = JSON.parse(await readFile(MAP, "utf8")).imports;
  } catch {
    throw new Error(
      ".lophn/import-map.json is missing. Create the app from the lophn template again.",
    );
  }
  const scratch = join(root, ".lophn/build-config.json");
  await writeFile(scratch, JSON.stringify({ imports }));
  const screens: string[] = [];
  try {
    for await (const entry of Deno.readDir(join(root, "src/screens"))) {
      if (entry.isDirectory) screens.push(entry.name);
    }
    for (const screen of screens.sort()) {
      const out = join(root, "dist/screens", screen);
      await rm(out, { recursive: true, force: true });
      await mkdir(out, { recursive: true });
      await esbuild.build({
        absWorkingDir: root,
        entryPoints: [join(root, "src/screens", screen, "main.tsx")],
        outdir: out,
        bundle: true,
        format: "esm",
        jsx: "automatic",
        minify: true,
        assetNames: "[name]",
        define: { "process.env.NODE_ENV": '"production"' },
        logLevel: "error",
        plugins: [
          assets(imports),
          ...(denoPlugins({ configPath: scratch }) as esbuild.Plugin[]),
        ],
      });
      await copyFile(
        join(root, "src/screens", screen, "index.html"),
        join(out, "index.html"),
      );
    }
  } finally {
    await rm(scratch, { force: true });
    await esbuild.stop();
  }
  return screens;
}

if (import.meta.main) {
  await build();
}
