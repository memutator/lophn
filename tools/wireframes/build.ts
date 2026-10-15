// 실행: deno task wireframes
// gallery를 정적 bundle(dist/index.html, main.js, main.css, 글꼴)로 만든다. 렌더러의 build()와 같은
// 방식(Deno import map, CSS Modules의 local-css, woff2 file loader)이지만, SDK 예제가 쓰는 ui-*
// package 전부를 import map에 올리려고 따로 짠 build다(렌더러의 build()는 일곱 개만 올린다).
// 주소는 모두 상대 경로이고 바깥 요청이 없다.
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { mergeImports } from "../../packages/shell/renderer/build.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
export const OUTPUT = join(here, "dist");

function fileUrl(path: string): URL {
  return path.startsWith("file:") ? new URL(path) : pathToFileURL(path);
}

// CSS Modules는 local-css, 나머지 CSS는 css, woff2는 file로 읽는다(렌더러의 assetPlugin과 같다). svg는 글로 읽어
// currentColor가 둘레 글자 색을 따르게 inline으로 그린다.
function assetPlugin(imports: Record<string, string>): esbuild.Plugin {
  return {
    name: "wireframes-assets",
    setup(build) {
      build.onResolve({ filter: /\.(css|woff2|svg)$/ }, (args) => {
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
        const loader: esbuild.Loader = path.endsWith(".svg")
          ? "text"
          : path.endsWith(".module.css")
          ? "local-css"
          : path.endsWith(".css")
          ? "css"
          : "file";
        return { path, namespace: "wireframes-asset", pluginData: { loader } };
      });
      build.onLoad(
        { filter: /.*/, namespace: "wireframes-asset" },
        async (args) => ({
          contents: await readFile(args.path),
          loader: args.pluginData.loader,
          resolveDir: dirname(args.path),
        }),
      );
    },
  };
}

// workspace package의 exports를 이름으로, 고정 imports를 그대로 map에 더한다.
async function addPackage(
  imports: Record<string, string>,
  directory: string,
): Promise<void> {
  const url = pathToFileURL(`${directory}/`);
  const config = JSON.parse(
    await readFile(new URL("deno.json", url), "utf8"),
  );
  if (config.exports !== undefined && config.name !== undefined) {
    const exports = typeof config.exports === "string"
      ? { ".": config.exports }
      : config.exports as Record<string, string>;
    const own: Record<string, string> = {};
    for (const [key, value] of Object.entries(exports)) {
      const specifier = key === "."
        ? config.name
        : `${config.name}/${key.slice(2)}`;
      own[specifier] = new URL(value, url).href;
    }
    mergeImports(imports, own, new URL("deno.json", url));
  }
  mergeImports(imports, config.imports ?? {}, new URL("deno.json", url));
}

async function importMap(): Promise<Record<string, string>> {
  const imports: Record<string, string> = {};
  const read = async (path: string) =>
    JSON.parse(await readFile(path, "utf8")).imports ?? {};
  for (const path of [join(root, "deno.json")]) {
    mergeImports(imports, await read(path), pathToFileURL(path));
  }
  mergeImports(
    imports,
    await read(join(root, "packages/shell/renderer/deno.json")),
    pathToFileURL(join(root, "packages/shell/renderer/deno.json")),
  );
  await addPackage(imports, join(root, "packages/design"));
  await addPackage(imports, join(root, "packages/design/wording"));
  await addPackage(imports, join(root, "packages/design/chart"));
  for (const entry of await readdir(join(root, "packages/sdk"))) {
    try {
      await stat(join(root, "packages/sdk", entry, "deno.json"));
    } catch {
      continue;
    }
    // blueprint는 앱 선언 type만 쓰는 곳이라 bundle에 들어가지 않는다.
    if (entry === "blueprint") continue;
    await addPackage(imports, join(root, "packages/sdk", entry));
  }
  return imports;
}

export async function buildGallery(outdir = OUTPUT): Promise<void> {
  await rm(outdir, { recursive: true, force: true });
  const scratch = await mkdtemp(join(tmpdir(), "wireframes-map-"));
  try {
    const imports = await importMap();
    const configPath = join(scratch, "deno.json");
    await writeFile(configPath, JSON.stringify({ imports }));
    await esbuild.build({
      absWorkingDir: here,
      entryPoints: [{ in: join(here, "main.tsx"), out: "main" }],
      outdir,
      bundle: true,
      format: "esm",
      jsx: "automatic",
      assetNames: "[name]",
      // 묶은 npm 패키지의 license 주석은 bundle 옆 .LEGAL.txt로 둔다.
      legalComments: "external",
      plugins: [
        assetPlugin(imports),
        ...(denoPlugins({ configPath }) as esbuild.Plugin[]),
      ],
    });
    await copyFile(join(here, "index.html"), join(outdir, "index.html"));
  } finally {
    await rm(scratch, { recursive: true });
    await esbuild.stop();
  }
}

if (import.meta.main) {
  await buildGallery();
  let total = 0;
  for (const name of (await readdir(OUTPUT)).sort()) {
    const { size } = await stat(join(OUTPUT, name));
    total += size;
    console.log(`${name}\t${size}`);
  }
  console.log(`total\t${total}\t${OUTPUT}`);
}
