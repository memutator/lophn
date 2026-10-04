import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { build } from "./build.ts";

const outputs = [
  "main.cjs",
  "preload-shell.cjs",
  "preload-confirmation.cjs",
  "preload-app.cjs",
];

test("shell/desktop#R17: build가 main과 preload 세 파일을 .cjs로 만들고 밖의 zod import를 묶는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-build-"));
  const fixture = join(dir, "fixture.ts");
  await writeFile(
    fixture,
    'import { z } from "zod";\nexport const schema = z.string();\n',
  );
  try {
    await build(dir, [{ in: fixture, out: "fixture" }]);
    for (const name of [...outputs, "fixture.cjs"]) {
      const text = await readFile(join(dir, name), "utf8");
      assert.ok(text.length > 0, `${name}가 비어 있다`);
    }
    const fixtureJs = await readFile(join(dir, "fixture.cjs"), "utf8");
    assert.equal(fixtureJs.includes('require("zod")'), false);
    assert.match(fixtureJs, /ZodString/);
    for (const name of outputs.filter((n) => n.startsWith("preload-"))) {
      const text = await readFile(join(dir, name), "utf8");
      const requires = [...text.matchAll(/require\("([^"]+)"\)/g)].map((m) =>
        m[1]
      );
      assert.deepEqual([...new Set(requires)], ["electron"]);
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});
