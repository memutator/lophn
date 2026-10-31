// 실행: npm run wireframes
// gallery를 정적 bundle(dist/index.html, main.js, main.css, 글꼴)로 만든다. 렌더러의 build()와 같은
// 방식(CSS Modules의 local-css, woff2 file loader)이지만, 예제가 쓰는 @lophn/app-ui까지 같은
// node_modules에서 푼다. 주소는 모두 상대 경로이고 바깥 요청이 없다.

import { copyFile, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(here, "dist");

// CSS Modules는 local-css, 나머지 CSS는 css, 글꼴(woff2·woff·ttf·eot)은 file로 읽는다(렌더러의 assetPlugin과
// 같다). svg는 글로 읽어 currentColor가 둘레 글자 색을 따르게 inline으로 그린다.
function assetPlugin(): esbuild.Plugin {
  return {
    name: "wireframes-assets",
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

async function buildGallery(outdir = OUTPUT): Promise<void> {
  await rm(outdir, { recursive: true, force: true });
  try {
    await esbuild.build({
      absWorkingDir: here,
      entryPoints: [{ in: join(here, "main.tsx"), out: "main" }],
      outdir,
      bundle: true,
      format: "esm",
      // mermaid 같은 무거운 library는 화면을 열 때만 가져오게 chunk로 낸다.
      splitting: true,
      chunkNames: "chunks/[name]-[hash]",
      jsx: "automatic",
      assetNames: "[name]",
      // 묶은 npm 패키지의 license 주석은 bundle 옆 .LEGAL.txt로 둔다.
      legalComments: "external",
      plugins: [assetPlugin()],
    });
    await copyFile(join(here, "index.html"), join(outdir, "index.html"));
  } finally {
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
