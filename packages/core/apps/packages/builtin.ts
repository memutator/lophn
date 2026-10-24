// `packages.builtin`. 설치 사본(`<data root>/sdk`)의 내장 SDK(@lophn/*)를 읽어 목록과 안내를 돌려준다.
// 내장 SDK는 catalog가 아니라 설치 사본이 정본이다(catalog에 등록하지 않는다).
import { err, ok, type Result } from "../../../base/mod.ts";
import type { BuiltinPackage } from "../../../protocol/apps/package-routes.ts";
import type { MemoryHandler } from "../../server/mod.ts";

const GUIDE_MAX_BYTES = 256 * 1024;

type Guide = { text: string; truncated: boolean };

function versionOrder(a: string, b: string): number {
  const left = a.split(/[.+-]/).map(Number);
  const right = b.split(/[.+-]/).map(Number);
  for (let at = 0; at < 3; at += 1) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0);
    if (diff !== 0) return diff;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

async function readDirNames(path: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(path)) {
      if (entry.isDirectory) names.push(entry.name);
    }
  } catch (cause) {
    if (!(cause instanceof Deno.errors.NotFound)) throw cause;
  }
  return names;
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return null;
    throw cause;
  }
}

// 선언 위의 주석 줄(`//`, JSDoc)이다.
function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("/*") ||
    trimmed.startsWith("*");
}

// source에서 `interface|type <name>` 선언 하나를 바로 위 주석과 함께 그대로 옮긴다. interface는 `}`에서, type은
// 괄호 밖 `;`에서 끝난다(deno fmt가 type 끝에 `;`를 붙인다). 못 찾으면 null이다.
function declarationOf(
  lines: readonly string[],
  name: string,
  exported: boolean,
): string | null {
  const head = new RegExp(
    `^${exported ? "export " : ""}(interface|type) ${name}\\b`,
  );
  const start = lines.findIndex((line) => head.test(line));
  if (start === -1) return null;
  const isType = /^(export )?type /.test(lines[start]);
  let first = start;
  while (first > 0 && isComment(lines[first - 1])) first -= 1;
  let depth = 0;
  for (let at = start; at < lines.length; at += 1) {
    for (const char of lines[at]) {
      if (char === "{" || char === "(") depth += 1;
      if (char === "}" || char === ")") depth -= 1;
    }
    const end = lines[at].trimEnd();
    if (depth === 0 && (isType ? end.endsWith(";") : end.endsWith("}"))) {
      return lines.slice(first, at + 1).join("\n");
    }
  }
  return null;
}

// 내보낸 type의 정의다. extends가 가리키는 같은 file의 내보내지 않은 type(`NativeInput` 같은 native 속성 묶음)을
// 앞에 붙인다. 그것 없이는 무엇을 더 받는지 보이지 않는다.
function typesOf(source: string, names: readonly string[]): string[] {
  const lines = source.split("\n");
  const found: string[] = [];
  for (const name of names) {
    const declaration = declarationOf(lines, name, true);
    if (declaration === null) continue;
    const parents = /\bextends ([\w, ]+)\{/.exec(declaration)?.[1] ?? "";
    for (const parent of parents.split(",").map((part) => part.trim())) {
      const local = parent === "" ? null : declarationOf(lines, parent, false);
      if (local !== null && !found.includes(local)) found.push(local);
    }
    found.push(declaration);
  }
  return found;
}

// 내보낸 type이 없는 component는 `export function <name>(`의 첫 인자 type을 옮긴다. 이름 붙은 type이면 그 정의이고,
// 인자 자리에 바로 쓴 type이면 signature 한 줄이다. 인자가 없으면 null이다. 부르는 쪽이 component(PascalCase)만 넘긴다.
function signatureOf(lines: readonly string[], name: string): string | null {
  const start = lines.findIndex((line) =>
    line.startsWith(`export function ${name}(`)
  );
  if (start === -1) return null;
  const text = lines.slice(start).join("\n");
  const open = text.indexOf("(");
  let depth = 0;
  let colon = -1;
  let close = -1;
  for (let at = open; at < text.length && close === -1; at += 1) {
    const char = text[at];
    if (char === "(" || char === "{") depth += 1;
    if (char === ")" || char === "}") depth -= 1;
    if (char === ":" && depth === 1 && colon === -1) colon = at;
    if (depth === 0) close = at;
  }
  if (colon === -1 || close === -1) return null;
  const type = text.slice(colon + 1, close).trim().replace(/,$/, "");
  if (/^\w+$/.test(type)) {
    return declarationOf(lines, type, false) ??
      declarationOf(lines, type, true);
  }
  return `function ${name}(props: ${type.replace(/\s+/g, " ")})`;
}

// components/<분류>/mod.ts에서 분류의 index를 뽑는다. export 문 바로 위 `//` 주석이 "언제 쓰나" 한 줄이라 따로 쓰면
// 낡는다. 같은 문이 내보내는 type(Props 등)은 component source의 정의를 주석째 옮겨 props를 보인다. 내보낸 type이 없으면
// component signature의 인자 type이다. 주석 없는 export는 뺀다.
async function indexOfCategory(
  folder: string,
  category: string,
  mod: string,
): Promise<string> {
  // 첫 줄은 분류 설명이라 다음 export의 주석에 섞지 않는다.
  const [summary, ...body] = mod.split("\n");
  const lines = [
    `## ${category}`,
    "",
    summary.replace(/^\/\/ ?/, ""),
    `import from \`@lophn/ui/${category}\``,
    "",
  ];
  let comment: string[] = [];
  let statement: string | null = null;
  for (const line of body) {
    if (statement !== null) {
      statement += ` ${line.trim()}`;
    } else if (line.startsWith("//")) {
      comment.push(line.slice(2).trim());
      continue;
    } else if (line.startsWith("export {")) {
      statement = line;
    } else {
      comment = [];
      continue;
    }
    if (!/from "[^"]+";/.test(statement)) continue;
    const parts = statement.slice(
      statement.indexOf("{") + 1,
      statement.indexOf("}"),
    ).split(",").map((part) => part.trim()).filter((part) => part !== "");
    const names = parts.filter((part) => !part.startsWith("type "));
    const types = parts.filter((part) => part.startsWith("type "))
      .map((part) => part.slice("type ".length));
    const from = /from "([^"]+)";/.exec(statement)?.[1];
    if (names.length > 0 && comment.length > 0) {
      lines.push(`- ${names.join(", ")}: ${comment.join(" ")}`);
      const source = from === undefined ? null : await readTextOrNull(
        new URL(from, `file://${folder}/components/${category}/`).pathname,
      );
      const found = source === null
        ? []
        : types.length > 0
        ? typesOf(source, types)
        : names.filter((name) => /^[A-Z][a-z]/.test(name))
          .flatMap((name) => signatureOf(source.split("\n"), name) ?? []);
      if (found.length > 0) {
        lines.push("", "```ts", found.join("\n\n"), "```", "");
      }
    }
    statement = null;
    comment = [];
  }
  return lines.join("\n");
}

// guide.md가 있으면 그것이다. 없고 components/<분류>/mod.ts가 있으면(@lophn/ui) 분류마다 export 이름, "언제 쓰나"
// 한 줄, props 정의의 index를 잇는다. 둘 다 없으면 null이다.
async function guideOf(folder: string): Promise<string | null> {
  const written = await readTextOrNull(`${folder}/guide.md`);
  if (written !== null) return written;
  const sections: string[] = [];
  for (const category of (await readDirNames(`${folder}/components`)).sort()) {
    if (category.startsWith("_")) continue;
    const mod = await readTextOrNull(
      `${folder}/components/${category}/mod.ts`,
    );
    if (mod !== null) {
      sections.push(await indexOfCategory(folder, category, mod));
    }
  }
  return sections.length === 0 ? null : sections.join("\n\n");
}

function limited(text: string): Guide {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= GUIDE_MAX_BYTES) return { text, truncated: false };
  const cut = new TextDecoder().decode(bytes.slice(0, GUIDE_MAX_BYTES));
  // 잘린 멀티바이트가 교체 문자로 끝에 남으면 버린다.
  return { text: cut.replace(/�$/, ""), truncated: true };
}

export function readBuiltinSdk(deps: { dataRoot: string }): MemoryHandler {
  const sdkRoot = `${deps.dataRoot}/sdk`;
  return async (_ctx, raw): Promise<Result<unknown>> => {
    const { name } = raw as { name?: string };
    try {
      const found: { entry: BuiltinPackage; text: string | null }[] = [];
      for (const part of await readDirNames(sdkRoot)) {
        if (part.startsWith("@")) continue;
        if (name !== undefined && name !== `@lophn/${part}`) continue;
        const newest = (await readDirNames(`${sdkRoot}/${part}`))
          .sort(versionOrder).at(-1);
        if (newest === undefined) continue;
        const text = await guideOf(`${sdkRoot}/${part}/${newest}`);
        found.push({
          entry: {
            name: `@lophn/${part}`,
            version: newest,
            has_guide: text !== null,
          },
          text,
        });
      }
      found.sort((a, b) => a.entry.name < b.entry.name ? -1 : 1);
      if (name === undefined) {
        return ok({ packages: found.map((one) => one.entry), guide: null });
      }
      const one = found[0];
      if (one === undefined) {
        return err({ code: "not_found", message: `${name} is not installed` });
      }
      return ok({
        packages: [one.entry],
        guide: one.text === null ? null : limited(one.text),
      });
    } catch {
      return err({
        code: "unavailable",
        message: "the installed SDK could not be read",
      });
    }
  };
}
