import { type Themed, tokens } from "./tokens.ts";

export interface FlatToken {
  readonly name: string;
  readonly path: readonly string[];
  readonly light: string;
  readonly dark?: string;
}

function isThemed(value: object): value is Themed {
  return "light" in value && "dark" in value;
}

function segment(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function flatten(source: unknown = tokens): FlatToken[] {
  const flat: FlatToken[] = [];
  const walk = (value: unknown, path: string[]) => {
    const name = `--${path.map(segment).join("-")}`;
    if (typeof value === "string" || typeof value === "number") {
      flat.push({ name, path, light: String(value) });
    } else if (typeof value === "object" && value !== null) {
      if (isThemed(value)) {
        flat.push({ name, path, light: value.light, dark: value.dark });
      } else {
        for (const [key, child] of Object.entries(value)) {
          walk(child, [...path, key]);
        }
      }
    }
  };
  walk(source, []);
  return flat;
}

const notice = "generate.ts가 만든다, 손으로 고치지 않는다";

export function renderCss(flat: readonly FlatToken[]): string {
  const light = flat.map((token) => `  ${token.name}: ${token.light};`);
  const dark = flat.filter((token) => token.dark !== undefined).map((token) =>
    `  ${token.name}: ${token.dark};`
  );
  return [
    `/* ${notice} */`,
    ":root {",
    "  color-scheme: light;",
    ...light,
    "}",
    "",
    '[data-theme="dark"] {',
    "  color-scheme: dark;",
    ...dark,
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    "    color-scheme: dark;",
    ...dark.map((line) => `  ${line}`),
    "  }",
    "}",
    "",
  ].join("\n");
}

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
    `export const tokenNames = ${
      JSON.stringify(flat.map((token) => token.name), null, 2)
    } as const;`,
    "export type TokenName = (typeof tokenNames)[number];",
    "",
  ].join("\n");
}

async function formatVars(source: string): Promise<string> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["fmt", "--ext=ts", "--quiet", "-"],
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
    "tokens.css": renderCss(flat),
    "vars.ts": await formatVars(renderVars(flat)),
    "token-names.ts": await formatVars(renderTokenNames(flat)),
    "values.json": JSON.stringify({ _generated: notice, tokens }, null, 2) +
      "\n",
  };
}

export async function staleFiles(
  outputs: Readonly<Record<string, string>>,
  directory = new URL("./generated/", import.meta.url),
): Promise<string[]> {
  const stale: string[] = [];
  for (const [file, expected] of Object.entries(outputs)) {
    try {
      if (await Deno.readTextFile(new URL(file, directory)) !== expected) {
        stale.push(file);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      stale.push(file);
    }
  }
  return stale;
}

if (import.meta.main) {
  const outputs = await generate();
  if (Deno.args.includes("--check")) {
    const stale = await staleFiles(outputs);
    if (stale.length) {
      console.error(`generated token 불일치: ${stale.join(", ")}`);
      Deno.exit(1);
    }
  } else {
    for (const [file, content] of Object.entries(outputs)) {
      await Deno.writeTextFile(
        new URL(`./generated/${file}`, import.meta.url),
        content,
      );
    }
  }
}
