// 파일 탭의 순수 규칙. 화면은 이 값을 그대로 그린다.
import { parseOutline } from "../../../protocol/projects/outline-markdown.ts";

export type FileKind = "markdown" | "text" | "image" | "pdf" | "html";

const MARKDOWN = /\.(md|markdown)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const PDF = /\.pdf$/i;
const HTML = /\.html?$/i;

/** 확장자로 viewer를 고른다. md가 아니고 이미지·pdf·html도 아니면 text 편집기다(html은 artifact 탭이 열고 소스는 text 편집기다). */
export function fileKindOf(path: string): FileKind {
  if (MARKDOWN.test(path)) return "markdown";
  if (IMAGE.test(path)) return "image";
  if (PDF.test(path)) return "pdf";
  if (HTML.test(path)) return "html";
  return "text";
}

/** 경로의 마지막 이름. */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  return parts.at(-1) ?? path;
}

/** 지침 파일. 없으면 빈 buffer로 열고 첫 저장이 만든다. */
export function isInstructionsFile(path: string): boolean {
  return fileNameOf(path) === "LOPHN.md";
}

/** project에 연결한 폴더 안의 파일인가. */
export function isInsideFolders(
  path: string,
  folders: readonly string[],
): boolean {
  return folders.some((folder) =>
    path.startsWith(folder.endsWith("/") ? folder : `${folder}/`)
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type CodeLanguage = "json" | "yaml" | null;

export function languageOf(path: string): CodeLanguage {
  if (/\.json$/i.test(path)) return "json";
  if (/\.ya?ml$/i.test(path)) return "yaml";
  return null;
}

/** outline의 절 하나. line은 제목 줄(1부터)이다. */
export interface OutlineSection {
  readonly key: string;
  readonly title: string;
  readonly level: number;
  readonly line: number;
}

/** 화면이 가진 본문에서 목차를 만든다. 편집 중에도 부른다. */
export function outlineOf(text: string): readonly OutlineSection[] {
  const outline = parseOutline("text/markdown", text);
  if (outline.status !== "ready") return [];
  return outline.sections.map((node) => ({
    key: node.key,
    title: node.title,
    level: node.level,
    line: node.subtree_range.start_line,
  }));
}

/** 읽기 위치에 저장하는 section key. 한도를 넘으면 문서 전체로 본다. */
export function sectionKeyOf(
  sections: readonly OutlineSection[],
  currentLine: number,
): string {
  let found: OutlineSection | undefined;
  for (const section of sections) {
    if (section.line <= currentLine) found = section;
    else break;
  }
  const raw = (found ?? sections[0])?.key ?? "document";
  return raw.length >= 1 && raw.length <= 128 ? raw : "document";
}
