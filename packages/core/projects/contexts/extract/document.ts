// 파일 하나를 ParsedDocument로 읽는다. 제목은 md 목차 parser(`parseMarkdownOutline`)가 찾고,
// frontmatter와 YAML 파일은 `@std/yaml`(core schema)로 읽는다.
import { parse as parseYaml } from "@std/yaml";
import {
  type MarkdownOutlineNode,
  parseMarkdownOutline,
} from "../../../../protocol/projects/mod.ts";
import type {
  DocumentReader,
  Heading,
  LineRange,
  ParsedDocument,
  ProjectFiles,
} from "./types.ts";

const FRONT_START = /^---[ \t]*$/;
const FRONT_END = /^(?:---|\.\.\.)[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;

function isYamlPath(path: string): boolean {
  return path.endsWith(".yaml") || path.endsWith(".yml");
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

// BOM을 떼고 줄바꿈을 LF로 맞춘다(outline parser와 같은 줄 번호를 얻는다).
function normalizeText(text: string): string {
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return withoutBom.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

// 글 앞머리 `---` 칸. 없으면 null. frontLines는 닫는 줄까지의 줄 수(outline parser와 같은 규칙).
function splitFrontmatter(
  lines: readonly string[],
): { yaml: string; frontLines: number } | null {
  if (!FRONT_START.test(lines[0] ?? "")) return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONT_END.test(lines[index] ?? "")) {
      return {
        yaml: lines.slice(1, index).join("\n"),
        frontLines: index + 1,
      };
    }
  }
  return null;
}

// 목차 tree를 문서 순서의 제목 목록으로 편다. line은 body 기준이다.
function headingsOf(
  nodes: readonly MarkdownOutlineNode[],
  frontLines: number,
): Heading[] {
  return nodes.flatMap((node): Heading[] => [
    {
      level: node.level,
      title: node.title,
      line: node.subtree_range.start_line - 1 - frontLines,
    },
    ...headingsOf(node.children, frontLines),
  ]);
}

function parseMarkdown(raw: string): ParsedDocument | null {
  const text = normalizeText(raw);
  const lines = text.split("\n");
  const front = splitFrontmatter(lines);
  let frontmatter: Record<string, unknown> = {};
  if (front !== null) {
    const value = readYaml(front.yaml);
    if (value === undefined) return null;
    if (value !== null) {
      if (!isRecord(value)) return null;
      frontmatter = value;
    }
  }
  const frontLines = front?.frontLines ?? 0;
  const headings = headingsOf(parseMarkdownOutline(text), frontLines);
  return {
    frontmatter,
    data: null,
    body: lines.slice(frontLines).join("\n"),
    headings,
  };
}

// 없는 파일, YAML 문법 오류, 객체가 아닌 frontmatter는 개체로 읽을 수 없어 null이다.
function parseDocument(
  files: ProjectFiles,
  path: string,
): ParsedDocument | null {
  const text = files.read(path);
  if (text === null) return null;
  if (isYamlPath(path)) {
    const data = readYaml(text);
    if (data === undefined) return null;
    return { frontmatter: {}, data, body: "", headings: [] };
  }
  return parseMarkdown(text);
}

// 제목 줄 다음 줄부터 section 끝까지. includeChildren이 false면 다음 제목(깊이 무관) 앞,
// true면 깊이가 같거나 얕은 다음 제목 앞이며 없으면 body 끝이다.
export function sectionRange(
  document: ParsedDocument,
  heading: Heading,
  includeChildren: boolean,
): LineRange {
  const lines = document.body.split("\n");
  // setext 제목은 밑줄 줄까지가 제목 줄이다.
  const isSetext = !(lines[heading.line] ?? "").trimStart().startsWith("#") &&
    SETEXT_UNDERLINE.test(lines[heading.line + 1] ?? "");
  const start = heading.line + (isSetext ? 2 : 1);
  const next = document.headings.find((candidate) =>
    candidate.line > heading.line &&
    (!includeChildren || candidate.level <= heading.level)
  );
  return { start, end: next?.line ?? lines.length };
}

// 줄 범위 안에 있는 제목들(문서 순서).
export function headingsIn(
  document: ParsedDocument,
  range: LineRange,
): Heading[] {
  return document.headings.filter((heading) =>
    heading.line >= range.start && heading.line < range.end
  );
}

export const readDocumentFrom =
  (files: ProjectFiles): DocumentReader => (path) => parseDocument(files, path);
