import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkSource } from "./check-source.ts";

test("core main graph의 bare fetch는 check가 막는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-check-source-"));
  try {
    const put = async (file: string, text: string) => {
      await mkdir(`${root}/${file.slice(0, file.lastIndexOf("/"))}`, {
        recursive: true,
      });
      await writeFile(`${root}/${file}`, text);
    };
    await put(
      "packages/core/main/daemon/main.ts",
      'import "../../x/call.ts";\n',
    );
    await put(
      "packages/core/x/call.ts",
      "export const a = (deps) => deps.fetch('u');\nexport const b = () => fetch('u');\n",
    );
    // main에서 import로 닿지 않는 child worker 쪽 file은 graph 밖이다.
    await put(
      "packages/core/x/worker.ts",
      "export const c = () => fetch('u');\n",
    );
    const issues = (await checkSource(root)).filter((i) =>
      i.file.startsWith("packages/core/x/")
    );
    assert.deepStrictEqual(
      issues.map((i) => `${i.file}:${i.line}:${i.rule}`),
      ["packages/core/x/call.ts:2:EXTERNAL_FETCH"],
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("DOM tag의 title 속성은 check가 막고 component prop과 document.title은 둔다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-check-source-"));
  try {
    const dir = `${root}/packages/design/components/x`;
    await mkdir(dir, { recursive: true });
    await writeFile(
      `${dir}/x.tsx`,
      [
        "export const a = <Card title={t('a')} />;",
        "export const b = (",
        "  <button",
        "    onClick={() => go()}",
        "    title={x}",
        "  />",
        ");",
        "document.title = 'w';",
        "el.setAttribute('title', 'x');",
        "",
      ].join("\n"),
    );
    const issues = (await checkSource(root)).filter((i) =>
      i.rule === "NATIVE_TITLE"
    );
    assert.deepStrictEqual(issues.map((i) => i.line), [5, 9]);
  } finally {
    await rm(root, { recursive: true });
  }
});
