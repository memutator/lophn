import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scaffoldApp } from "./scaffold.ts";

const files = [
  { path: "main.ts", bytes: new TextEncoder().encode("// {{APP}}\n") },
  { path: "src/tools.ts", bytes: new TextEncoder().encode("template\n") },
];

test("이미 있는 앱 폴더의 파일은 덮지 않고 빠진 파일만 채운다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-scaffold-"));
  try {
    await writeFile(`${dir}/main.ts`, "mine\n");
    const result = await scaffoldApp({ files, dir, app: "demo" });
    assert.deepStrictEqual(result.ok && result.value.files, ["src/tools.ts"]);
    assert.deepStrictEqual(await readFile(`${dir}/main.ts`, "utf8"), "mine\n");
    assert.deepStrictEqual(
      await readFile(`${dir}/src/tools.ts`, "utf8"),
      "template\n",
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});
