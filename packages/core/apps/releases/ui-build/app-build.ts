// 앱 화면 build의 신뢰된 실행. 앱 폴더의 build script는 AI가 쓴 code라 그 실수가 준비에 퍼지지 않게
// 준비는 앱이 쓴 `scripts/build-ui.ts`를 실행하지 않고 이 파일이 같은 일을 한다. esbuild 입력은 staging의
// `src/screens/<key>/main.tsx`로 고정이고 출력은 `dist/screens/<key>/`뿐이다. 앱 코드는 번들될 뿐 실행되지
// 않는다. 호출자는 env에 필요한 이름만 넘겨 띄운다.
// 사용: deno run ... app-build.ts <staging 폴더> <설치 SDK 폴더> <Deno 캐시 폴더>
// 불러오는 모든 파일은 realpath가 staging·설치 SDK·Deno 캐시 안이어야 하고 밖이면(절대 경로·`../`·symlink)
// build가 실패한다. 밖의 파일이 화면에 묶여 운영 때 읽히지 않게 한다.
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCREEN_KEY = /^[a-z0-9][a-z0-9-]*$/;

// CSS Modules·CSS·글꼴·svg는 import map이 가리키는 설치 사본의 파일을 esbuild loader로 읽는다.
function assets(imports: Record<string, string>): esbuild.Plugin {
  return {
    name: "app-assets",
    setup(build) {
      build.onResolve({ filter: /\.(css|woff2|svg)$/ }, (args) => {
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
        loader: args.path.endsWith(".svg")
          ? "text"
          : args.path.endsWith(".module.css")
          ? "local-css"
          : args.path.endsWith(".css")
          ? "css"
          : "file",
        resolveDir: dirname(args.path),
      }));
    },
  };
}

// 불러오는 파일이 허용한 폴더 안(realpath 기준)에 있는지 본다. 파일 내용은 오류에 싣지 않는다.
function guard(roots: readonly string[]): esbuild.Plugin {
  const inside = (path: string) =>
    roots.some((base) => path === base || path.startsWith(`${base}/`));
  return {
    name: "path-guard",
    setup(build) {
      build.onLoad({ filter: /.*/ }, async (args) => {
        if (
          (args.namespace !== "file" && args.namespace !== "app-asset") ||
          !args.path.startsWith("/")
        ) return undefined;
        let real: string;
        try {
          real = await realpath(args.path);
        } catch {
          return { errors: [{ text: "import is outside the app build area" }] };
        }
        return inside(real)
          ? undefined
          : { errors: [{ text: "import is outside the app build area" }] };
      });
    },
  };
}

const [root, sdkRoot, denoDir] = process.argv.slice(2);
if (root === undefined || sdkRoot === undefined || denoDir === undefined) {
  throw new Error("build arguments are missing");
}
const allowed = await Promise.all(
  [root, sdkRoot, denoDir].map((path) => realpath(path)),
);
const imports: Record<string, string> =
  JSON.parse(await readFile(join(root, ".lophn/import-map.json"), "utf8"))
    .imports;
const scratch = join(root, ".lophn/build-config.json");
await writeFile(scratch, JSON.stringify({ imports }));
try {
  const screens: string[] = [];
  for (
    const entry of await readdir(join(root, "src/screens"), {
      withFileTypes: true,
    })
  ) {
    if (entry.isDirectory() && SCREEN_KEY.test(entry.name)) {
      screens.push(entry.name);
    }
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
      // 준비가 이 main.js를 다시 묶어 화면 map(main.js.map)을 만든다. inline이어야 그 map이 원래 source를 잇는다.
      sourcemap: "inline",
      sourcesContent: true,
      assetNames: "[name]",
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "error",
      plugins: [
        guard(allowed),
        assets(imports),
        ...(denoPlugins({
          configPath: scratch,
          loader: "native",
        }) as esbuild.Plugin[]),
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
