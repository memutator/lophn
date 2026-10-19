// 파일 하나의 문서 data를 읽는다. md는 frontmatter map, yaml·json은 최상위 map이다. md 본문은 칸이 아니다.
import { parse as parseYaml } from "@std/yaml";

const FRONT_START = /^---[ \t]*$/;
const FRONT_END = /^(?:---|\.\.\.)[ \t]*$/;

export type DocumentData = Record<string, unknown>;

function isRecord(value: unknown): value is DocumentData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 읽을 수 없으면 undefined.
function readYaml(text: string): unknown {
  try {
    return parseYaml(text, { schema: "core" });
  } catch {
    return undefined;
  }
}

// 글 앞머리 `---` 칸의 yaml 글. 없으면 null.
function frontmatterOf(text: string): string | null {
  const withoutBom = text.startsWith("﻿") ? text.slice(1) : text;
  const lines = withoutBom.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    .split("\n");
  if (!FRONT_START.test(lines[0] ?? "")) return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONT_END.test(lines[index] ?? "")) {
      return lines.slice(1, index).join("\n");
    }
  }
  return null;
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

// 문서 data. 읽을 수 없으면(읽기 실패, YAML 문법 오류, map이 아님) null. md·yaml·json이 아닌 형식은 data가
// 없어 파일을 열지 않고 빈 map이다.
export function readDocument(
  path: string,
  read: (path: string) => string | null,
): DocumentData | null {
  const extension = extensionOf(path);
  const isMarkdown = extension === "md";
  if (!isMarkdown && !["yaml", "yml", "json"].includes(extension)) return {};
  const text = read(path);
  if (text === null) return null;
  const source = isMarkdown ? frontmatterOf(text) : text;
  if (source === null) return {};
  const value = readYaml(source);
  if (value === undefined) return null;
  if (isMarkdown && value === null) return {};
  return isRecord(value) ? value : null;
}
