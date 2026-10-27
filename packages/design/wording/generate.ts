// 영역 file(catalog/<영역>.ts)의 ICU 문장에서 placeholder 종류를 뽑아 catalog/<영역>.placeholders.ts를 만든다.
// 실행: deno run --allow-read --allow-write packages/design/wording/generate.ts [--check]
import { readdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { errorCode } from "../../base/mod.ts";
import { AREAS, en } from "./en.ts";

type Kind = "string" | "number" | "plural" | "date";

const kindOf = new Map<number, Kind>([
  [TYPE.argument, "string"],
  [TYPE.select, "string"],
  [TYPE.number, "number"],
  [TYPE.date, "date"],
  [TYPE.time, "date"],
  [TYPE.plural, "plural"],
]);

function walk(elements: MessageFormatElement[], found: Map<string, Kind>) {
  for (const element of elements) {
    if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
    if (element.type === TYPE.plural || element.type === TYPE.select) {
      found.set(element.value, kindOf.get(element.type)!);
      for (const option of Object.values(element.options)) {
        walk(option.value, found);
      }
      continue;
    }
    if (element.type === TYPE.tag) {
      walk(element.children, found);
      continue;
    }
    found.set(element.value, kindOf.get(element.type) ?? "string");
  }
}

export function placeholdersOf(message: string): Map<string, Kind> {
  const found = new Map<string, Kind>();
  walk(parse(message), found);
  return found;
}

function field(names: Map<string, Kind>): string {
  if (names.size === 0) return "Record<never, never>";
  const lines = [...names].map(([name, kind]) => `    ${name}: "${kind}";`);
  return `{\n${lines.join("\n")}\n  }`;
}

// command는 헤더 문장의 재생성 명령이다. 앱 catalog는 자기 명령(deno task wording)을 준다.
export function render(
  catalog: Record<string, string>,
  command = "deno run -A generate.ts",
): string {
  const entries = Object.entries(catalog).map(([key, message]) =>
    `  ${JSON.stringify(key)}: ${field(placeholdersOf(message))};`
  );
  return [
    `// en.ts에서 생성한다. 직접 고치지 않고 \`${command} --check\`로 맞춘다.`,
    'import type { MessageKey } from "./en.ts";',
    "",
    "export type PlaceholderKinds = {",
    entries.join("\n"),
    "};",
    "",
    'type ValueFor<T> = T extends "plural" | "number" ? number',
    '  : T extends "date" ? Date',
    "  : string;",
    "",
    "export type ValuesOf<K extends MessageKey> = {",
    "  [P in keyof PlaceholderKinds[K]]: ValueFor<PlaceholderKinds[K][P]>;",
    "};",
    "",
    "export type HasPlaceholders<K extends MessageKey> = [",
    "  keyof PlaceholderKinds[K],",
    "] extends [never] ? false",
    "  : true;",
    "",
    "type _SameKeys =",
    "  | Exclude<MessageKey, keyof PlaceholderKinds>",
    "  | Exclude<keyof PlaceholderKinds, MessageKey>;",
    "const _sameKeys: [_SameKeys] extends [never] ? true : never = true;",
    "void _sameKeys;",
    "",
  ].join("\n");
}

const COMMAND =
  "deno run --allow-read --allow-write packages/design/wording/generate.ts";

const camel = (name: string) =>
  name.replace(/(?:^|-)(\w)/g, (_, c: string) => c.toUpperCase());

function renderArea(name: string, catalog: Record<string, string>): string {
  const type = `${camel(name)}Placeholders`;
  const entries = Object.entries(catalog).map(([key, message]) =>
    `  ${JSON.stringify(key)}: ${field(placeholdersOf(message))};`
  );
  const area = camel(name).replace(/^./, (c) => c.toLowerCase());
  return [
    `// catalog/${name}.ts에서 생성한다. 직접 고치지 않고 \`${COMMAND}\`로 다시 만든다.`,
    `import type { ${area} } from "./${name}.ts";`,
    "",
    `export type ${type} = {`,
    entries.join("\n"),
    "};",
    "",
    `type Area = typeof ${area};`,
    "type _SameKeys =",
    `  | Exclude<keyof Area, keyof ${type}>`,
    `  | Exclude<keyof ${type}, keyof Area>;`,
    "const _sameKeys: [_SameKeys] extends [never] ? true : never = true;",
    "void _sameKeys;",
    "",
  ].join("\n");
}

async function main() {
  const dir = new URL("./catalog/", import.meta.url);
  // 영역 file이 AREAS에 없거나 영역 사이에 같은 key가 있으면 실패한다.
  const names = Object.keys(AREAS);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (!name.endsWith(".ts") || name.endsWith(".placeholders.ts")) continue;
    if (!names.includes(name.slice(0, -3))) {
      console.error(`catalog/${name}가 en.ts의 AREAS에 없다.`);
      process.exit(1);
    }
  }
  const total = Object.values(AREAS).reduce(
    (sum, area) => sum + Object.keys(area).length,
    0,
  );
  if (Object.keys(en).length !== total) {
    console.error(
      `영역 file 사이에 같은 key가 있다: en ${
        Object.keys(en).length
      }개, 영역 합 ${total}개.`,
    );
    process.exit(1);
  }
  const stale: string[] = [];
  for (const [name, area] of Object.entries(AREAS)) {
    const file = `${name}.placeholders.ts`;
    const target = new URL(file, dir);
    const next = renderArea(name, area);
    if (process.argv.slice(2).includes("--check")) {
      let current = "";
      try {
        current = await readFile(target, "utf8");
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
      if (current !== next) stale.push(`catalog/${file}`);
    } else {
      await writeFile(target, next);
    }
  }
  if (stale.length > 0) {
    console.error(
      `${stale.join(", ")}가 영역 file과 다르다. generate.ts를 다시 돌린다.`,
    );
    process.exit(1);
  }
}

if (import.meta.main) await main();
