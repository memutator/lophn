// 앱 화면 build의 신뢰된 실행(apps/releases#R3, apps/sdk#R10, R34). 앱 source는 신뢰하지 않으므로 준비는
// 앱이 쓴 `scripts/build-ui.ts`를 실행하지 않고 이 파일이 같은 일을 한다. esbuild 입력은 staging의
// `src/screens/<key>/main.tsx`로 고정이고 출력은 `dist/screens/<key>/`뿐이다. 앱 코드는 번들될 뿐 실행되지
// 않는다. 호출자가 run은 deno·esbuild 실행 파일만, write는 staging만, env는 이름만 허락해 띄운다.
// 사용: deno run ... app-build.ts <staging 폴더>
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCREEN_KEY = /^[a-z0-9][a-z0-9-]*$/;

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

const root = Deno.args[0];
if (root === undefined) throw new Error("staging folder is missing");
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
      assetNames: "[name]",
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "error",
      plugins: [
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
