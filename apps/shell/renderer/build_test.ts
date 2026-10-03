import { assert } from "@std/assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "./build.ts";

const outputs = ["desktop", "overlay", "confirmation"];

Deno.test("shell/desktop#R17: renderer build가 entry 세 개와 scope된 CSS Modules class를 만든다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-renderer-"));
  try {
    await build(dir);
    for (const name of outputs) {
      const js = await readFile(join(dir, `${name}.js`), "utf8");
      const css = await readFile(join(dir, `${name}.css`), "utf8");
      const scoped = css.match(/^\.([a-zA-Z0-9_-]*root[a-zA-Z0-9_-]*)/m)?.[1];
      assert(scoped, `${name}.css에 scope된 class가 없다`);
      assert(scoped !== "root", `${name}.css의 class가 원문 그대로다`);
      assert(
        js.includes(scoped),
        `${name}.js의 클래스 맵이 ${scoped}을 가리키지 않는다`,
      );
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});
