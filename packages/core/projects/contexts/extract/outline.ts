// outline source: 문서 하나의 목차 전체가 개체 하나다. md 파일의 제목에서 목차를 읽는다(읽을 수 없으면
// unreadable 위반). min_level·max_level은
// 개체 수를 정하지 않고 개체가 가진 목차의 깊이를 제한한다. 제목마다 개체를 만드는 일은 section source의 몫이다.
// 순서는 from_type 개체 순 다음 문서 경로 순이다.
import { outlineDocumentPaths } from "./outline-documents.ts";
import type {
  EntityAnchor,
  ExtractViolation,
  KindExtractor,
  OutlineEntry,
} from "./types.ts";

// 확장자를 뺀 파일 이름. docs.ts의 file capture와 같은 규칙이다(맨 앞 `.`만 있는 이름은 그대로).
function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export const outlineKind: KindExtractor<"outline"> = (type, context) => {
  const { min_level, max_level } = type.source;
  const anchors: EntityAnchor[] = [];
  const violations: ExtractViolation[] = [];
  for (const path of outlineDocumentPaths(type.source, context)) {
    const document = context.readDocument(path);
    const all: readonly OutlineEntry[] | null = document === null
      ? null
      : document.headings.map((heading) => ({
        level: heading.level,
        title: heading.title,
      }));
    // 목차를 읽을 수 없는 문서는 개체를 만들지 않고 unreadable 위반으로 센다.
    if (all === null) {
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
    anchors.push({
      type: type.name,
      path,
      section: null,
      captures: { file: fileStem(path), path },
      scope: {
        kind: "outline",
        title: all.find((entry) => entry.level === 1)?.title ?? null,
        entries: all.filter((entry) =>
          entry.level >= min_level && entry.level <= max_level
        ),
      },
    });
  }
  return { anchors, violations };
};
