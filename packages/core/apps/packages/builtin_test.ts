import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { packagesBuiltinOutputSchema } from "../../../protocol/apps/package-routes.ts";
import { readBuiltinSdk } from "./builtin.ts";

const CATEGORIES = ["alpha", "beta", "gamma", "delta"];
const PER_CATEGORY = 10;
const FIELDS = 20;

const encoder = new TextEncoder();

function componentName(category: string, at: number): string {
  return `${category[0]!.toUpperCase()}${category.slice(1)}${at}`;
}

// props 정의가 예산을 넘도록 긴 type 하나를 만든다.
function propsOf(name: string): string {
  const lines = [`export type ${name}Props = {`];
  for (let at = 0; at < FIELDS; at += 1) {
    lines.push(`  field${at}: "value-${at}-${"x".repeat(20)}";`);
  }
  lines.push("};");
  return `${lines.join("\n")}\n`;
}

function modOf(category: string): string {
  const lines = [`// ${category}: 테스트 분류 설명.`];
  for (let at = 0; at < PER_CATEGORY; at += 1) {
    const name = componentName(category, at);
    lines.push(`// ${name}을 언제 쓰나.`);
    lines.push(
      `export { ${name}, type ${name}Props } from "./${name.toLowerCase()}/${name.toLowerCase()}.tsx";`,
    );
  }
  return `${lines.join("\n")}\n`;
}

// components/<분류>/mod.ts와 component file 묶음. 분류마다 props가 예산을 넘을 만큼 크다.
async function sdkFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lophn-builtin-guide-"));
  const folder = join(root, "sdk", "ui", "1.0.0");
  for (const category of CATEGORIES) {
    const dir = join(folder, "components", category);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "mod.ts"), modOf(category));
    for (let at = 0; at < PER_CATEGORY; at += 1) {
      const name = componentName(category, at);
      const own = join(dir, name.toLowerCase());
      await mkdir(own, { recursive: true });
      await writeFile(join(own, `${name.toLowerCase()}.tsx`), propsOf(name));
    }
  }
  return root;
}

// 예산이 모자라도 분류가 통째로 사라지지 않는다. 이름·"언제 쓰나" 줄은 늘 남고, props를 뺀 분류는 뺐다고 적는다.
test("props 예산이 모자라도 모든 분류의 이름 줄이 남고 뺀 props는 그 분류에 적힌다", async () => {
  const root = await sdkFolder();
  try {
    const read = readBuiltinSdk({ dataRoot: root });
    const answer = await read({} as never, { name: "@lophn/ui" });
    assert.ok(answer.ok);
    const parsed = packagesBuiltinOutputSchema.parse(answer.value);
    const guide = parsed.guide;
    assert.ok(guide !== null);
    const text = guide.text;
    const sections = text.split(/\n(?=## )/u);
    assert.equal(sections.length, CATEGORIES.length);
    for (const category of CATEGORIES) {
      const section = sections.find((part) =>
        part.startsWith(`## ${category}\n`),
      );
      assert.ok(section !== undefined, `${category} section is missing`);
      assert.match(
        section,
        new RegExp(`import from \`@lophn/ui/${category}\``),
      );
      for (let at = 0; at < PER_CATEGORY; at += 1) {
        assert.ok(section.includes(`- ${componentName(category, at)}`));
      }
      assert.ok(
        section.includes("```ts") || section.includes("예산 밖"),
        `${category} has neither props nor an omission line`,
      );
    }
    assert.ok(text.includes("예산 밖이라 뺐다"));
    // 한 창(TEXT_MAX_BYTES)에 다 들어와야 package.read 한 번으로 색인이 온다.
    assert.ok(encoder.encode(text).byteLength < 24 * 1024);

    const again = await read({} as never, { name: "@lophn/ui" });
    assert.ok(again.ok);
    assert.equal(
      packagesBuiltinOutputSchema.parse(again.value).guide?.text,
      text,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
