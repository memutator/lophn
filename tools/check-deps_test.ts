import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkRepo } from "./check-deps.ts";

test("extension 폴더가 host 내부나 다른 extension을 import하면 check가 막는다", async () => {
  for (const host of [
    "packages/shell/main/extensions",
    "packages/core/extensions",
  ]) {
    const root = await mkdtemp(join(tmpdir(), "lophn-check-deps-"));
    try {
      const put = async (file: string, text: string) => {
        await mkdir(`${root}/${file.slice(0, file.lastIndexOf("/"))}`, {
          recursive: true,
        });
        await writeFile(`${root}/${file}`, text);
      };
      const dir = `${host}/bundled`;
      await put(`${host}/inner/inner.ts`, "export const x = 1;\n");
      await put(`${host}/registry.ts`, "export const r = 1;\n");
      await put("packages/protocol/extensions/mod.ts", "export const p = 1;\n");
      await put(`${dir}/b/helper.ts`, "export const h = 1;\n");
      await put(`${dir}/a/helper.ts`, "export const h = 1;\n");
      const protocol = `${"../".repeat(dir.split("/").length + 1)}packages/protocol/extensions/mod.ts`;
      await put(
        `${dir}/a/index.ts`,
        [
          'import "../../inner/inner.ts";',
          'import "../../registry.ts";',
          'import "../b/helper.ts";',
          'import "electron";',
          `import "${protocol}";`,
          'import "./helper.ts";',
          "",
        ].join("\n"),
      );
      const found = (await checkRepo(root))
        .filter((v) => v.rule === "extension")
        .map((v) => v.line);
      assert.deepStrictEqual(found, [1, 2, 3, 4], host);
    } finally {
      await rm(root, { recursive: true });
    }
  }
});
