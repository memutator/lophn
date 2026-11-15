import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
// SDK 사본에 싣는 package.json에 test 도구를 적지 않는다. esbuild는 저장소 root가 준다.
// biome-ignore lint/correctness/noUndeclaredDependencies: test 전용
import { build } from "esbuild";

// 폰 backend는 Node 내장 module이 없는 Hermes에서 돈다. 세 SDK를 폰 조건으로 묶었을 때 `node:` import가 남으면
// 폰에서 앱이 뜨지 않는다.
test("세 SDK를 폰 조건으로 묶으면 node: import가 하나도 남지 않는다", async () => {
  const result = await build({
    stdin: {
      contents: [
        'import "@lophn/cap-store";',
        'import "@lophn/cap-tool";',
        'import "@lophn/cap-problem";',
      ].join("\n"),
      resolveDir: fileURLToPath(new URL("../../..", import.meta.url)),
    },
    bundle: true,
    write: false,
    metafile: true,
    platform: "neutral",
    conditions: ["lophn-phone"],
    format: "esm",
    logLevel: "silent",
  });
  const inputs = Object.entries(result.metafile.inputs);
  for (const part of ["cap-store", "cap-tool", "cap-problem"]) {
    assert.ok(inputs.some(([path]) => path.endsWith(`${part}/mod.phone.ts`)));
  }
  const nodeImports = inputs.flatMap(([path, input]) =>
    input.imports
      .filter((item) => item.path.startsWith("node:"))
      .map((item) => `${path} -> ${item.path}`),
  );
  assert.deepStrictEqual(nodeImports, []);
});
