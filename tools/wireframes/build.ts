// 실행: deno task wireframes
// gallery를 정적 bundle(dist/index.html, main.js, main.css, 글꼴)로 만든다. 렌더러의 build()를 그대로
// 써서 import map·CSS Modules·woff2 처리가 앱과 같다. 주소는 모두 상대 경로이고 바깥 요청이 없다.
import { copyFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "../../apps/shell/renderer/build.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUTPUT = join(here, "dist");

export async function buildGallery(outdir = OUTPUT): Promise<void> {
  await rm(outdir, { recursive: true, force: true });
  await build(outdir, [{ in: join(here, "main.tsx"), out: "main" }]);
  // build()는 제품 창의 index.html도 outdir 아래에 두는데 gallery는 쓰지 않는다.
  for (const name of ["desktop", "overlay", "confirmation"]) {
    await rm(join(outdir, name), { recursive: true, force: true });
  }
  await copyFile(join(here, "index.html"), join(outdir, "index.html"));
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
