import { assertEquals } from "@std/assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build, stylesheets } from "./build.ts";

const outputs = ["desktop", "overlay", "confirmation"];

Deno.test("shell/desktop#R17: renderer build가 entry 세 개와 CSS Modules 원문을 만든다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-renderer-"));
  try {
    await build(dir);
    for (const name of outputs) {
      const js = await readFile(join(dir, `${name}.js`), "utf8");
      assertEquals(js.length > 0, true);
      const css = await readFile(join(dir, `${name}.css`), "utf8");
      const source = await readFile(
        stylesheets.find((sheet) => sheet.to === `${name}.css`)!.from,
        "utf8",
      );
      assertEquals(css, source);
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});
