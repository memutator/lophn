import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { flatten, type FlatToken, renderCss } from "./flatten.ts";
import { tokens } from "./tokens.ts";

// design은 base에 기대지 않는다. file 오류의 code(`ENOENT` …)를 그 자리에서 읽는다.
function codeOf(thrown: unknown): unknown {
  return (thrown as { code?: unknown } | null)?.code;
}

const notice = "generate.ts가 만든다, 손으로 고치지 않는다";

export function renderVars(flat: readonly FlatToken[]): string {
  type Tree = { [key: string]: Tree | string };
  const tree: Tree = {};
  for (const token of flat) {
    let node = tree;
    token.path.forEach((key, index) => {
      if (index === token.path.length - 1) node[key] = `var(${token.name})`;
      else node = (node[key] ??= {}) as Tree;
    });
  }
  // 이름 목록은 token-names.ts로 나눠 각 생성 TS가 400줄을 넘지 않게 하고 기존 import 길은 다시 내보낸다.
  return [
    `// ${notice}`,
    'export { tokenNames } from "./token-names.ts";',
    'export type { TokenName } from "./token-names.ts";',
    `export const vars = ${JSON.stringify(tree, null, 2)} as const;`,
    "export type TokenVars = typeof vars;",
    "",
  ].join("\n");
}

export function renderTokenNames(flat: readonly FlatToken[]): string {
  return [
    `// ${notice}`,
    `export const tokenNames = ${JSON.stringify(
      flat.map((token) => token.name),
      null,
      2,
    )} as const;`,
    "export type TokenName = (typeof tokenNames)[number];",
    "",
  ].join("\n");
}

// 생성한 file이 check.ts의 Biome format 단계를 그대로 통과하도록 같은 설정으로 맞춘다.
async function formatVars(source: string, file: string): Promise<string> {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "npm:@biomejs/biome@2.6.3",
      "format",
      `--stdin-file-path=${file}`,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(source));
  await writer.close();
  const result = await child.output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout);
}

export async function generate(): Promise<Record<string, string>> {
  const flat = flatten();
  return {
    "tokens.css": `/* ${notice} */\n${renderCss(flat)}`,
    "vars.ts": await formatVars(renderVars(flat), "vars.ts"),
    "token-names.ts": await formatVars(
      renderTokenNames(flat),
      "token-names.ts",
    ),
    "values.json":
      JSON.stringify({ _generated: notice, tokens }, null, 2) + "\n",
  };
}

export async function staleFiles(
  outputs: Readonly<Record<string, string>>,
  directory = new URL("./generated/", import.meta.url),
): Promise<string[]> {
  const stale: string[] = [];
  for (const [file, expected] of Object.entries(outputs)) {
    try {
      if ((await readFile(new URL(file, directory), "utf8")) !== expected) {
        stale.push(file);
      }
    } catch (error) {
      if (codeOf(error) !== "ENOENT") throw error;
      stale.push(file);
    }
  }
  return stale;
}

if (import.meta.main) {
  const outputs = await generate();
  if (process.argv.slice(2).includes("--check")) {
    const stale = await staleFiles(outputs);
    if (stale.length) {
      console.error(`generated token 불일치: ${stale.join(", ")}`);
      process.exit(1);
    }
  } else {
    for (const [file, content] of Object.entries(outputs)) {
      await writeFile(new URL(`./generated/${file}`, import.meta.url), content);
    }
  }
}
