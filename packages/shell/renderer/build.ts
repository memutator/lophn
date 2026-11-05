// 화면은 <name>/<name>.js(esm)로, artifact kit은 <script>로 불러서 artifact-kit/entry.js(iife)로 나간다.
// 화면과 highlight worker는 dynamic import(mermaid, 문법 grammar)를 chunk로 내려고 splitting한다.
// bare specifier와 package export는 node_modules의 package.json이 푼다.
import * as esbuild from "esbuild";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const screens = ["desktop", "overlay", "secret-input"];

// CSS Modules는 local-css, 나머지 CSS는 css, woff2는 file로 읽고 svg는 currentColor가 둘레 글자 색을
// 따르게 inline으로 그린다.
function assetPlugin(): esbuild.Plugin {
  return {
    name: "renderer-assets",
    setup(build) {
      build.onLoad({ filter: /\.(css|woff2?|ttf|eot|svg)$/ }, async (args) => {
        if (args.namespace !== "file") return undefined;
        const loader: esbuild.Loader = args.path.endsWith(".svg")
          ? "text"
          : args.path.endsWith(".module.css")
            ? "local-css"
            : args.path.endsWith(".css")
              ? "css"
              : "file";
        return {
          contents: await readFile(args.path),
          loader,
          resolveDir: dirname(args.path),
        };
      });
    },
  };
}

const entries: readonly {
  in: string;
  out: string;
  dir: string;
  format: esbuild.Format;
  splitting?: boolean;
  chunkNames?: string;
}[] = [
  ...screens.map((name) => ({
    in: join(name, "entry.tsx"),
    out: name,
    dir: name,
    format: "esm" as const,
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
  })),
  {
    in: join("artifact-kit", "entry.tsx"),
    out: "entry",
    dir: "artifact-kit",
    format: "iife",
  },
  {
    in: join("highlight", "worker.ts"),
    out: "highlight-worker",
    dir: "desktop",
    format: "esm",
    splitting: true,
  },
];

async function build(outdir = join(here, "dist")): Promise<void> {
  // hash 이름이라 다시 묶으면 옛 grammar chunk가 쌓인다. tools/package/main.ts가 dist를 통째로 복사한다.
  await rm(join(outdir, "desktop", "highlight"), {
    recursive: true,
    force: true,
  });
  // 화면 chunk도 hash 이름이라 다시 묶으면 옛 chunk가 쌓인다.
  await rm(join(outdir, "desktop", "chunks"), {
    recursive: true,
    force: true,
  });
  for (const entry of entries) {
    await esbuild.build({
      absWorkingDir: here,
      entryPoints: [{ in: entry.in, out: entry.out }],
      outdir: join(outdir, entry.dir),
      bundle: true,
      format: entry.format,
      splitting: entry.splitting ?? false,
      chunkNames: entry.chunkNames ?? "highlight/[name]-[hash]",
      jsx: "automatic",
      assetNames: "[name]",
      // 묶은 npm 패키지(xterm.css 등)의 license 주석은 bundle 옆 .LEGAL.txt로 둔다.
      // 창이 읽는 CSS·JS에 바깥 주소가 남지 않는다.
      legalComments: "external",
      // dev-mock·dev-seed는 dev build(LOPHN_RENDERER_DEV=1)에서만 싣는다. tools/dev.ts가 이 값을 준다.
      define: {
        "import.meta.env.DEV": String(process.env.LOPHN_RENDERER_DEV === "1"),
      },
      plugins: [assetPlugin()],
    });
  }
  // 첫 창은 lophn-shell://desktop/index.html로 연다. 문구가 없는 정적 html이다.
  for (const name of screens) {
    await mkdir(join(outdir, name), { recursive: true });
    await copyFile(
      join(here, name, "index.html"),
      join(outdir, name, "index.html"),
    );
  }
}

if (import.meta.main) {
  await build();
}
