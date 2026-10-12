// path capture, links, item field. 값이 없으면 null이다. 규칙은
// docs/domain-model/documents/contexts.md의 "추출 규칙"이다.
import { headingsIn, sectionRange } from "../document.ts";
import { markdownLinks } from "../links.ts";
import type {
  FieldContext,
  FieldReader,
  LineRange,
  ParsedDocument,
} from "../types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 개체가 잡은 path capture 값. 없는 이름이면 null.
export const pathField: FieldReader<"path"> = (from, context) => {
  const { captures } = context.anchor;
  return Object.hasOwn(captures, from.capture) ? captures[from.capture] : null;
};

// 링크를 찾는 범위. 문서 개체는 본문 전체, section 개체는 그 section(하위 포함)이다.
// outline field와 같은 범위다.
function entityRange(
  document: ParsedDocument,
  context: FieldContext,
): LineRange | null {
  const { scope } = context.anchor;
  if (scope.kind === "document") {
    return { start: 0, end: document.body.split("\n").length };
  }
  if (scope.kind === "section") {
    return sectionRange(document, scope.heading, true);
  }
  return null;
}

// 범위 안 줄과 제목만 남긴 글. 링크 풀이(markdownLinks)가 범위 밖을 보지 않게 한다.
function sliceDocument(
  document: ParsedDocument,
  range: LineRange,
): ParsedDocument {
  return {
    frontmatter: {},
    data: null,
    body: document.body.split("\n").slice(range.start, range.end).join("\n"),
    headings: headingsIn(document, range).map((heading) => ({
      ...heading,
      line: heading.line - range.start,
    })),
  };
}

// 문서 안 링크를 Project 경로 목록으로 낸다. 존재는 보지 않는다.
// within 제목이 범위 안에 없거나 글을 읽을 수 없으면 null이다.
// to_type이 있으면 그 type 개체의 경로에 맞는 링크만 남긴다(key로 바꾸는 일은 run.ts가 한다).
export const linksField: FieldReader<"links"> = (from, context) => {
  const { document } = context;
  if (document === null) return null;
  const range = entityRange(document, context);
  if (range === null) return null;
  const scoped = sliceDocument(document, range);
  if (
    from.within !== undefined &&
    !scoped.headings.some((heading) => heading.title === from.within)
  ) {
    return null;
  }
  const targets = markdownLinks(context.anchor.path, scoped, from.within)
    .filter((link) => link.inside)
    .map((link) => link.target);
  if (from.to_type === undefined) return targets;
  const typed = new Set(
    context.anchorsOf(from.to_type).map((anchor) => anchor.path),
  );
  return targets.filter((target) => typed.has(target));
};

// app-data 개체(결과 배열의 항목)에서 key_path를 따라간 값. 없으면 null.
export const itemField: FieldReader<"item"> = (from, context) => {
  const { scope } = context.anchor;
  if (scope.kind !== "item") return null;
  let value: unknown = scope.item;
  for (const key of from.key_path) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return null;
    value = value[key];
  }
  return value ?? null;
};
