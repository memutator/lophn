// 파일 하나를 ParsedDocument로 읽는다. 제목은 md outline parser가 찾고,
// frontmatter와 YAML 파일은 `@std/yaml`(core schema)로 읽는다.
import type {
  DocumentReader,
  Heading,
  LineRange,
  ParsedDocument,
  ProjectFiles,
} from "./types.ts";

// 없는 파일, YAML 문법 오류, 객체가 아닌 frontmatter는 개체로 읽을 수 없어 null이다.
export function parseDocument(
  _files: ProjectFiles,
  _path: string,
): ParsedDocument | null {
  return null;
}

// 제목 줄 다음 줄부터 section 끝까지. includeChildren이 false면 다음 제목(깊이 무관) 앞,
// true면 깊이가 같거나 얕은 다음 제목 앞이며 없으면 body 끝이다.
export function sectionRange(
  _document: ParsedDocument,
  _heading: Heading,
  _includeChildren: boolean,
): LineRange {
  return { start: 0, end: 0 };
}

// 줄 범위 안에 있는 제목들(문서 순서).
export function headingsIn(
  _document: ParsedDocument,
  _range: LineRange,
): Heading[] {
  return [];
}

export const readDocumentFrom =
  (files: ProjectFiles): DocumentReader => (path) => parseDocument(files, path);
