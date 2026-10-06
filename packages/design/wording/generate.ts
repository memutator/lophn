// en catalog의 ICU 문장에서 placeholder 종류를 뽑아 placeholders.ts를 만든다.
// 실행: deno run -A generate.ts [--check]
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { en } from "./en.ts";

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

if (import.meta.main) {
  const target = new URL("./placeholders.ts", import.meta.url);
  const next = render(en);
  if (Deno.args.includes("--check")) {
    const current = await Deno.readTextFile(target);
    if (current !== next) {
      console.error(
        "placeholders.ts가 en catalog와 다르다. generate.ts를 다시 돌린다.",
      );
      Deno.exit(1);
    }
  } else {
    await Deno.writeTextFile(target, next);
  }
}
