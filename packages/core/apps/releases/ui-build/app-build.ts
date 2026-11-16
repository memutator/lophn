// 앱 화면 build의 신뢰된 실행. 앱 폴더의 build script는 AI가 쓴 code라 그 실수가 준비에 퍼지지 않게
// 준비는 앱이 쓴 `scripts/build-ui.ts`를 실행하지 않고 이 파일이 같은 일을 한다. 화면 dir
// `src/screens/<key>/`에는 desktop 화면의 `main.tsx`나 폰 화면의 `phone.tsx`(`phone/build.ts`) 중 하나만 있고,
// 출력은 `dist/screens/<key>/`뿐이다. 앱 code는 번들될 뿐 실행되지 않는다. 호출자는 env에 필요한 이름만 넘겨 띄운다.
// 사용: node app-build.ts <staging 폴더>
// import는 staging 안에서 푼다: staging의 `node_modules`와 `.lophn/sdk` 사본이다. staging 밖의 file(lophn
// repo의 node_modules 등)이 화면에 묶이지 않게 realpath가 staging 밖인 file은 build가 실패한다.

import { copyFile, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import * as esbuild from "esbuild";
import { buildPhoneScreen, describeBuildFailure } from "./phone/build.ts";
import { stagingGuard } from "./staging-guard.ts";

const SCREEN_KEY = /^[a-z0-9][a-z0-9-]*$/;

async function buildDesktopScreen(base: string, screen: string, out: string) {
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
    logLevel: "silent",
    plugins: [stagingGuard(base)],
  });
  await copyFile(
    join(base, "src/screens", screen, "index.html"),
    join(out, "index.html"),
  );
}

const root = process.argv[2];
if (root === undefined) throw new Error("build argument is missing");
const base = await realpath(root);
const screens: { key: string; files: string[] }[] = [];
// 화면 없는 앱(tool만 내는 `["computer"]` 앱)에는 src/screens가 없다.
const screenDirs = await readdir(join(base, "src/screens"), {
  withFileTypes: true,
}).catch((thrown: unknown) => {
  if ((thrown as { code?: unknown } | null)?.code === "ENOENT") return [];
  throw thrown;
});
for (const entry of screenDirs) {
  if (entry.isDirectory() && SCREEN_KEY.test(entry.name)) {
    screens.push({
      key: entry.name,
      files: await readdir(join(base, "src/screens", entry.name)),
    });
  }
}
try {
  for (const { key, files } of screens.sort((a, b) =>
    a.key < b.key ? -1 : 1,
  )) {
    const desktop = files.includes("main.tsx");
    const phone = files.includes("phone.tsx");
    if (desktop === phone) {
      throw new Error(
        desktop
          ? `src/screens/${key} has both main.tsx and phone.tsx. A screen is either a desktop screen (main.tsx) or a phone screen (phone.tsx); give the phone screen its own key.`
          : `src/screens/${key} has neither main.tsx (desktop screen) nor phone.tsx (phone screen).`,
      );
    }
    const out = join(base, "dist/screens", key);
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    if (desktop) await buildDesktopScreen(base, key, out);
    else await buildPhoneScreen(base, key, out);
  }
} catch (thrown) {
  // 준비가 stderr 앞 5줄을 agent에게 넘긴다. esbuild의 여러 줄 log 대신 오류마다 `file:line:column: 이유` 한 줄이다.
  process.stderr.write(`${describeBuildFailure(thrown)}\n`);
  process.exitCode = 1;
} finally {
  await esbuild.stop();
}
