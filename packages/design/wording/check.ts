// 화면 코드의 고정 문구를 검사한다. 오류는 실패, 경고는 결과 목록이다.
import { parse } from "@formatjs/icu-messageformat-parser";
import { AREAS, en } from "./en.ts";
import {
  ID_PREFIX,
  INTERNAL_WORD,
  INTERNAL_WORDS,
  keyShape,
  RAW_ENUM,
  SHORT_PARTS,
  SNAKE_WORD,
  TEXT_ATTRIBUTES,
} from "./rules.ts";
import { scan } from "./scan.ts";
import { placeholdersOf } from "./generate.ts";

export type Severity = "error" | "warning";

export type Finding = {
  file: string;
  line: number;
  severity: Severity;
  rule: string;
  message: string;
};

export type CheckOptions = {
  // key의 첫 구간으로 허용할 화면 이름. 없으면 kebab-case 이름이면 통과하고, 앱은 자기 screen key와 common을 준다.
  screens?: readonly string[];
};

const CALLED = new Set(["t"]);

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function visibleText(text: string): boolean {
  const words = text.replace(/\{[^}]*\}/g, "").trim();
  return /[A-Za-z]/.test(words);
}

function keyParts(key: string): [string, string, string] | undefined {
  const parts = key.split(".");
  if (parts.length !== 3) return;
  return [parts[0], parts[1], parts[2]];
}

// 버튼·제목·한 단어 라벨은 마침표가 없고, 여러 단어 문장은 마침표가 있다.
function expectsPeriod(key: string): boolean {
  const parts = keyParts(key);
  if (!parts) return false;
  if (SHORT_PARTS.has(parts[1]) || SHORT_PARTS.has(parts[2])) return false;
  return true;
}

// `t("key", { a, b })` 호출이 넘긴 값 이름. 값 없는 호출은 "none"이고, 객체 literal이 아니거나 펼침·계산된 이름이
// 있어 알 수 없으면 undefined다(검사하지 않는다).
function passedValues(
  source: string,
  from: number,
): string[] | "none" | undefined {
  let index = from;
  while (/\s/.test(source[index] ?? "")) index += 1;
  if (source[index] === ")") return "none";
  if (source[index] !== ",") return undefined;
  index += 1;
  while (/\s/.test(source[index] ?? "")) index += 1;
  if (source[index] === ")") return "none";
  if (source[index] !== "{") return undefined;
  const names: string[] = [];
  let depth = 0;
  let segment = "";
  const flush = (): boolean => {
    const text = segment.trim();
    segment = "";
    if (text === "") return true;
    if (text.startsWith("...") || text.startsWith("[")) return false;
    const name = /^(?:([A-Za-z_$][\w$]*)|"([^"]+)"|'([^']+)')/.exec(text);
    if (!name) return false;
    names.push(name[1] ?? name[2] ?? name[3]);
    return true;
  };
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      segment += char;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          segment += source[index];
          index += 1;
        }
        segment += source[index];
        index += 1;
      }
      segment += quote;
      continue;
    }
    if (char === "{" || char === "(" || char === "[") {
      depth += 1;
      if (depth === 1) continue;
    } else if (char === "}" || char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0) return flush() ? names : undefined;
    } else if (char === "," && depth === 1) {
      if (!flush()) return undefined;
      continue;
    }
    segment += char;
  }
  return undefined;
}

function messageText(message: string): string {
  return message.replace(/\{[^{}]*\}/g, " ").replace(/#/g, " ");
}

export function checkSource(
  file: string,
  source: string,
  catalog: Record<string, string> = en,
  options: CheckOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  const add = (
    index: number,
    severity: Severity,
    rule: string,
    message: string,
  ) =>
    findings.push({
      file,
      line: lineOf(source, index),
      severity,
      rule,
      message,
    });

  for (const part of scan(source)) {
    const index = part.start;
    if (part.kind === "text" && visibleText(part.text)) {
      add(
        index,
        "error",
        "literal-text",
        "화면 코드에 직접 문구가 있다. message key를 쓴다.",
      );
    }
    if (part.kind !== "string") continue;
    const before = source.slice(0, index);
    const attribute = /(?:^|[\s])([a-z-]+)\s*=\s*$/.exec(before);
    if (
      attribute && TEXT_ATTRIBUTES.has(attribute[1]) && visibleText(part.text)
    ) {
      add(
        index,
        "error",
        "literal-attribute",
        `${attribute[1]}에 직접 문구가 있다. message key를 쓴다.`,
      );
    }
    const call = /(?:^|[^A-Za-z0-9_])([A-Za-z]+)\(\s*$/.exec(before);
    if (!call || !CALLED.has(call[1])) continue;
    if (!(part.text in catalog)) {
      add(index, "error", "unknown-key", `없는 message key: ${part.text}`);
      continue;
    }
    if (!(part.text in catalog)) continue;
    // 호출이 넘긴 값 이름이 ICU 문장의 placeholder와 같아야 한다.
    let expected: string[];
    try {
      expected = [...placeholdersOf(catalog[part.text]).keys()].sort();
    } catch {
      continue;
    }
    const passed = passedValues(source, index + part.text.length + 2);
    if (passed === undefined) continue;
    const given = passed === "none" ? [] : [...passed].sort();
    if (given.join(",") !== expected.join(",")) {
      add(
        index,
        "error",
        "placeholder-mismatch",
        `${part.text}의 값이 문장의 placeholder와 다르다: 필요 {${
          expected.join(", ")
        }}, 넘김 {${given.join(", ")}}`,
      );
    }
  }

  if (!file.endsWith(".tsx")) {
    checkCatalog(source, catalog, keyShape(options.screens), add);
  }
  return findings;
}

function checkCatalog(
  source: string,
  catalog: Record<string, string>,
  shape: RegExp,
  add: (
    index: number,
    severity: Severity,
    rule: string,
    message: string,
  ) => void,
) {
  for (const [key, message] of Object.entries(catalog)) {
    const index = source.indexOf(JSON.stringify(key));
    const at = index === -1 ? 0 : index;
    if (!shape.test(key)) {
      add(
        at,
        "error",
        "key-shape",
        `key 모양이 <screen>.<part>.<name>이 아니다: ${key}`,
      );
    }
    if (message.trim() === "") {
      add(at, "error", "empty-message", `${key}의 en 값이 비었다.`);
      continue;
    }
    try {
      parse(message);
    } catch (error) {
      add(at, "error", "icu-syntax", `${key}의 ICU 문법이 잘못됐다: ${error}`);
      continue;
    }
    const endsWithPeriod = message.trimEnd().endsWith(".");
    if (expectsPeriod(key) && !endsWithPeriod) {
      add(at, "error", "missing-period", `${key}는 문장인데 마침표가 없다.`);
    }
    if (!expectsPeriod(key) && endsWithPeriod) {
      add(at, "error", "extra-period", `${key}는 버튼·제목인데 마침표가 있다.`);
    }
    const part = keyParts(key)?.[1];
    if (part === "diagnostics") continue;
    const text = messageText(message);
    if (SNAKE_WORD.test(text)) {
      add(
        at,
        "warning",
        "snake-case",
        `${key}의 en 값에 snake_case 단어가 있다.`,
      );
    }
    if (ID_PREFIX.test(text)) {
      add(
        at,
        "warning",
        "id-prefix",
        `${key}의 en 값에 ID 접두사 모양이 있다.`,
      );
    }
    if (RAW_ENUM.test(text)) {
      add(at, "warning", "raw-enum", `${key}의 en 값에 원시 enum 모양이 있다.`);
    }
    if (INTERNAL_WORD.test(text)) {
      add(
        at,
        "warning",
        "internal-word",
        `${key}의 en 값에 안쪽 개념 단어(${INTERNAL_WORDS.join(", ")})가 있다.`,
      );
    }
  }
}

const SOURCE_GLOBS = [
  "packages/shell/renderer",
  "packages/sdk",
  "packages/design/components",
  "packages/design/reading",
];

async function collect(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string) {
    // 없는 대상(packages/sdk가 아직 없을 때)은 지나간다.
    try {
      if (!(await Deno.stat(dir)).isDirectory) return;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name === "testdata" || entry.name === "node_modules") {
          continue;
        }
        await visit(path);
      } else if (
        entry.name.endsWith(".tsx") && !entry.name.endsWith("_test.tsx")
      ) {
        // 테스트의 fixture 문구는 사용자 화면이 아니다.
        files.push(path);
      }
    }
  }
  for (const glob of SOURCE_GLOBS) await visit(`${root}/${glob}`);
  return files.sort();
}

// 화면 코드 묶음 검사.
export async function checkScreens(
  root: string,
  options: CheckOptions = {},
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const path of await collect(root)) {
    const relative = path.slice(root.length + 1);
    findings.push(
      ...checkSource(relative, await Deno.readTextFile(path), en, options),
    );
  }
  // catalog 위반은 고칠 영역 file 이름으로 낸다.
  for (const [name, area] of Object.entries(AREAS)) {
    const file = `packages/design/wording/catalog/${name}.ts`;
    findings.push(
      ...checkSource(
        file,
        await Deno.readTextFile(`${root}/${file}`),
        area,
        options,
      ),
    );
  }
  return findings;
}

export function errorsOf(findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.severity === "error");
}
