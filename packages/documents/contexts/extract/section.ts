// section source: documents(또는 from_type 개체의 문서)에서 level과 title_pattern이 맞는
// heading 하나가 개체 하나다. section은 heading 글이다.
// 순서는 문서 path의 code unit 순, 문서 안에서는 위치 순이다. from_type이면 그 type 개체의 순서를 따른다.
import picomatch from "picomatch";
import { matcherFor } from "./docs-paths.ts";
import type {
  EntityAnchor,
  ExtractViolation,
  KindExtractor,
  TypeOfKind,
} from "./types.ts";

// 제목 글에는 `/`가 올 수 있으나 glob의 `*`는 `/`를 넘지 못한다. 양쪽의 `/`를 같은 글자로 바꿔 맞춘다.
const SLASH = "\u0000";

function titleMatcher(pattern: string | undefined): (title: string) => boolean {
  if (pattern === undefined) return () => true;
  const regex = picomatch.makeRe(pattern.replaceAll("/", SLASH), {
    dot: true,
    fastpaths: false,
    windows: false,
  });
  return (title) => regex.test(title.replaceAll("/", SLASH));
}

// 읽을 문서 path들. documents는 Project 파일 순서, from_type은 그 type 개체의 순서(같은 문서는 한 번).
function documentPaths(
  source: TypeOfKind<"section">["source"],
  paths: readonly string[],
  anchorsOf: (typeName: string) => readonly EntityAnchor[],
): string[] {
  if (source.from_type !== undefined) {
    const found = anchorsOf(source.from_type)
      .filter((anchor) =>
        anchor.scope.kind === "document" || anchor.scope.kind === "section"
      )
      .map((anchor) => anchor.path);
    return [...new Set(found)];
  }
  const matchers = (source.documents ?? []).map(matcherFor);
  return paths.filter((path) => matchers.some((matches) => matches(path)));
}

export const sectionKind: KindExtractor<"section"> = (type, context) => {
  const { level, title_pattern } = type.source;
  const titleMatches = titleMatcher(title_pattern);
  const anchors: EntityAnchor[] = [];
  const violations: ExtractViolation[] = [];
  for (
    const path of documentPaths(
      type.source,
      context.files.paths(),
      context.anchorsOf,
    )
  ) {
    const document = context.readDocument(path);
    if (document === null) {
      violations.push({
        kind: "unreadable",
        rule: null,
        type: type.name,
        path,
        section: null,
        target: null,
      });
      continue;
    }
    for (const heading of document.headings) {
      if (heading.level !== level || !titleMatches(heading.title)) continue;
      anchors.push({
        type: type.name,
        path,
        section: heading.title,
        captures: { file: fileStem(path), path },
        scope: { kind: "section", heading },
      });
    }
  }
  return { anchors, violations };
};

// 파일 이름에서 확장자를 뺀 값(맨 앞 `.`만 있는 이름은 그대로).
function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
