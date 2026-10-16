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
const entries = ["desktop", "overlay", "secret-input"];

function fileUrl(path: string): URL {
  return path.startsWith("file:") ? new URL(path) : pathToFileURL(path);
}

function assetPlugin(imports: Record<string, string>): esbuild.Plugin {
  return {
    name: "renderer-assets",
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

const defaultEntries = entries.map((name) => ({
  in: join(name, "entry.tsx"),
  out: name,
}));

// 같은 specifier가 다른 판을 가리키면 React가 두 벌이 될 수 있어 build를 멈춘다.
function addImport(
  imports: Record<string, string>,
  key: string,
  value: string,
): void {
  if (imports[key] !== undefined && imports[key] !== value) {
    throw new Error(`import map conflict for ${key}`);
  }
  imports[key] = value;
}

export function mergeImports(
  imports: Record<string, string>,
  values: Record<string, string>,
  configUrl: URL,
): void {
  for (const [key, value] of Object.entries(values)) {
    addImport(
      imports,
      key,
      value.startsWith(".") ? new URL(value, configUrl).href : value,
    );
  }
}

// workspace package의 exports를 이름으로, 고정 imports를 그대로 map에 더한다.
async function addPackage(
  imports: Record<string, string>,
  directory: URL,
): Promise<void> {
  const config = JSON.parse(
    await readFile(new URL("deno.json", directory), "utf8"),
  );
  const exports = typeof config.exports === "string"
    ? { ".": config.exports }
    : config.exports as Record<string, string>;
  for (const [key, value] of Object.entries(exports)) {
    const specifier = key === "."
      ? config.name
      : `${config.name}/${key.slice(2)}`;
    addImport(imports, specifier, new URL(value, directory).href);
  }
  mergeImports(imports, config.imports ?? {}, new URL("deno.json", directory));
}

async function build(
  outdir = join(here, "dist"),
  entryPoints: readonly { in: string; out: string }[] = defaultEntries,
): Promise<void> {
  // 없는 workspace 폴더의 탐색을 피하되 임시 map에서도 로컬 import의 기준 경로를 유지한다.
  const scratch = await mkdtemp(join(tmpdir(), "shell-renderer-map-"));
  const configPath = join(scratch, "deno.json");
  try {
    const config = JSON.parse(await readFile(join(here, "deno.json"), "utf8"));
    const rootConfig = JSON.parse(
      await readFile(join(here, "../../../deno.json"), "utf8"),
    );
    const imports: Record<string, string> = {};
    mergeImports(
      imports,
      rootConfig.imports ?? {},
      pathToFileURL(join(here, "../../../deno.json")),
    );
    mergeImports(
      imports,
      config.imports ?? {},
      pathToFileURL(join(here, "deno.json")),
    );
    // 공통 UI와 SDK가 쓰는 React·Radix·Lucide·d3·wording·chart를 같은 map에서 찾는다.
    const design = new URL(
      "../../design/",
      pathToFileURL(`${here}/`),
    );
    await addPackage(imports, design);
    await addPackage(imports, new URL("wording/", design));
    await addPackage(imports, new URL("chart/", design));
    // renderer가 import하는 protocol 런타임 code가 `@lophn/base`를 쓴다.
    await addPackage(imports, new URL("../base/", design));
    for (
      const name of [
        "tokens",
        "ui-control",
        "ui-overlay",
        "ui-layout",
        "ui-state",
        "ui-table",
        "ui-chart",
      ]
    ) {
      await addPackage(imports, new URL(`../sdk/${name}/`, design));
    }
    await writeFile(configPath, JSON.stringify({ imports }));
    for (const entry of entryPoints) {
      const directory = entryPoints === defaultEntries
        ? join(outdir, entry.out)
        : outdir;
      await esbuild.build({
        absWorkingDir: here,
        entryPoints: [entry],
        outdir: directory,
        bundle: true,
        format: "esm",
        jsx: "automatic",
        assetNames: "[name]",
        // 묶은 npm 패키지(xterm.css 등)의 license 주석은 bundle 옆 .LEGAL.txt로 둔다.
        // 창이 읽는 CSS·JS에 바깥 주소가 남지 않는다.
        legalComments: "external",
        plugins: [
          assetPlugin(imports),
          ...(denoPlugins({ configPath }) as esbuild.Plugin[]),
        ],
      });
    }
    // 첫 창은 lophn-shell://desktop/index.html로 연다. 문구가 없는 정적 html이다.
    for (const name of ["desktop", "overlay", "secret-input"]) {
      await mkdir(join(outdir, name), { recursive: true });
      await copyFile(
        join(here, name, "index.html"),
        join(outdir, name, "index.html"),
      );
    }
  } finally {
    await rm(scratch, { recursive: true });
  }
}

if (import.meta.main) {
  await build();
}
