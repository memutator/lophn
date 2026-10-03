// shell·overlay·confirmation entry를 각각 브라우저 bundle 하나로 만든다.
// deno bundle은 CSS Modules를 클래스 맵으로 바꾸지 않는다. 그래서 entry가 import한
// *.module.css를 원문 그대로 bundle 옆의 같은 이름 css 파일로 복사하고, 화면이 그 파일을
// 읽어 클래스를 적용한다. design token과 글꼴 복사는 T4에서 더한다.
import { copyFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const dist = join(here, "dist");

const entries = ["desktop", "overlay", "confirmation"];

export const stylesheets = entries.map((name) => ({
  from: join(here, name, "entry.module.css"),
  to: `${name}.css`,
}));

export async function build(outdir = dist): Promise<void> {
  await mkdir(outdir, { recursive: true });
  for (const name of entries) {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "bundle",
        "--platform=browser",
        "--outdir",
        outdir,
        join(here, name, "entry.tsx"),
      ],
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!(await command.output()).success) {
      throw new Error("renderer bundle 실패");
    }
    // --outdir에서는 출력 이름이 entry 파일 이름을 따른다. 다음 entry가 덮어쓰기 전에 옮긴다.
    await rename(join(outdir, "entry.js"), join(outdir, `${name}.js`));
  }
  for (const sheet of stylesheets) {
    await copyFile(sheet.from, join(outdir, sheet.to));
  }
}

if (import.meta.main) {
  await build();
}
