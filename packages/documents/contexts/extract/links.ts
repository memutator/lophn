// 문서 안 Markdown 링크 `[글](경로)`를 문서 폴더 기준으로 푼다. index kind와 links field가 함께 쓴다.
import type { ParsedDocument } from "./types.ts";

export type MarkdownLink = {
  text: string;
  // 문서 폴더 기준으로 푼 정규 경로(`./`, `../`, `#조각`, `?query` 정리). Project 밖이면 `../`로 시작한다.
  target: string;
  inside: boolean;
};

// 문서 순서. `within`이 있으면 그 제목의 section(하위 포함) 안 링크만.
// 주소 scheme이 있는 링크(https:, mailto:)와 `#`만 있는 링크는 문서 링크가 아니라 뺀다.
export function markdownLinks(
  _documentPath: string,
  _document: ParsedDocument,
  _within?: string,
): MarkdownLink[] {
  return [];
}
