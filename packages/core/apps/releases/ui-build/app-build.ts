// 앱 화면 build의 신뢰된 실행. 앱 폴더의 build script는 AI가 쓴 code라 그 실수가 준비에 퍼지지 않게
// 준비는 앱이 쓴 `scripts/build-ui.ts`를 실행하지 않고 이 파일이 같은 일을 한다. esbuild 입력은 staging의
// `src/screens/<key>/main.tsx`로 고정이고 출력은 `dist/screens/<key>/`뿐이다. 앱 code는 번들될 뿐 실행되지
// 않는다. 호출자는 env에 필요한 이름만 넘겨 띄운다.
// 사용: node app-build.ts <staging 폴더>
// import는 staging 안에서 푼다: staging의 `node_modules`와 `.lophn/sdk` 사본이다. staging 밖의 file(lophn
// repo의 node_modules 등)이 화면에 묶이지 않게 realpath가 staging 밖인 file은 build가 실패한다.

import { copyFile, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import * as esbuild from "esbuild";

const SCREEN_KEY = /^[a-z0-9][a-z0-9-]*$/;

// 불러오는 file이 허용한 폴더 안(realpath 기준)에 있는지 본다. file 내용은 오류에 싣지 않는다.
function guard(root: string): esbuild.Plugin {
  return {
    name: "staging-only",
    setup(build) {
      build.onLoad({ filter: /.*/, namespace: "file" }, async (args) => {
        if (!args.path.startsWith("/")) return undefined;
        let real: string;
        try {
          real = await realpath(args.path);
        } catch {
          return { errors: [{ text: "import is outside the app build area" }] };
        }
        return real === root || real.startsWith(`${root}/`)
          ? undefined
          : { errors: [{ text: "import is outside the app build area" }] };
      });
    },
  };
}

const root = process.argv[2];
if (root === undefined) throw new Error("build argument is missing");
const base = await realpath(root);
const screens: string[] = [];
for (const entry of await readdir(join(base, "src/screens"), {
  withFileTypes: true,
})) {
  if (entry.isDirectory() && SCREEN_KEY.test(entry.name)) {
    screens.push(entry.name);
  }
}
try {
  for (const screen of screens.sort()) {
    const out = join(base, "dist/screens", screen);
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    await esbuild.build({
      absWorkingDir: base,
      entryPoints: [join(base, "src/screens", screen, "main.tsx")],
      outdir: out,
      bundle: true,
      format: "esm",
      jsx: "automatic",
      minify: true,
      // 준비가 이 main.js를 다시 묶어 화면 map(main.js.map)을 만든다. inline이어야 그 map이 원래 source를 잇는다.
      sourcemap: "inline",
      sourcesContent: true,
      assetNames: "[name]",
      // UI Package는 CSS Modules과 svg를 import하고 base.css가 font file을 가리킨다. font는 화면 폴더에 file로 둔다.
      loader: {
        ".module.css": "local-css",
        ".svg": "text",
        ".woff2": "file",
        ".woff": "file",
      },
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "error",
      plugins: [guard(base)],
    });
    await copyFile(
      join(base, "src/screens", screen, "index.html"),
      join(out, "index.html"),
    );
  }
} finally {
  await esbuild.stop();
}
