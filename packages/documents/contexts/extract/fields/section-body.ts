import { headingsIn, sectionRange } from "../document.ts";
import type {
  FieldContext,
  FieldReader,
  Heading,
  LineRange,
  ParsedDocument,
} from "../types.ts";

// field가 값을 찾는 범위. 문서 개체는 body 전체, section 개체는 그 section(하위 포함).
// 문서가 없거나 section이 아닌 scope면 null.
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

function trimBlankLines(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start += 1;
  while (end > start && lines[end - 1]!.trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

export const sectionField: FieldReader<"section"> = (from, context) => {
  const { document } = context;
  if (document === null) return null;
  const range = entityRange(document, context);
  if (range === null) return null;
  const heading = headingsIn(document, range).find((candidate) =>
    candidate.title === from.heading
  );
  if (heading === undefined) return null;
  const body = sectionRange(document, heading, from.include_children);
  const end = Math.min(body.end, range.end);
  return trimBlankLines(
    document.body.split("\n").slice(body.start, Math.max(body.start, end)),
  );
};

export const titleField: FieldReader<"title"> = (_from, context) => {
  const { scope } = context.anchor;
  if (scope.kind === "section") return scope.heading.title;
  const { document } = context;
  if (document === null) return null;
  const first: Heading | undefined = document.headings.find((heading) =>
    heading.level === 1
  );
  return first?.title ?? null;
};

export const outlineField: FieldReader<"outline"> = (from, context) => {
  const { document } = context;
  if (document === null) return null;
  const range = entityRange(document, context);
  if (range === null) return null;
  return headingsIn(document, range)
    .filter((heading) => heading.level <= from.max_level)
    .map((heading) => ({ level: heading.level, title: heading.title }));
};
