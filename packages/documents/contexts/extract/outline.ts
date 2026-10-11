// outline source: 문서마다 제목 tree의 heading 가운데 min_level부터 max_level까지의 것 하나가 개체 하나다.
// 개체의 section은 heading 글이고, 범위는 그 heading 하나다. 저장하지 않고 쓸 때마다 읽는다.
// 순서는 from_type 개체 순 다음 문서 안 heading 순서다(문서 안 순서는 parser가 준다).
import { outlineDocumentPaths } from "./outline-documents.ts";
import type {
  EntityAnchor,
  ExtractViolation,
  Heading,
  KindExtractor,
} from "./types.ts";

// 확장자를 뺀 파일 이름. docs.ts의 file capture와 같은 규칙이다(맨 앞 `.`만 있는 이름은 그대로).
function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function headingAnchor(
  type: string,
  path: string,
  heading: Heading,
): EntityAnchor {
  return {
    type,
    path,
    section: heading.title,
    captures: { file: fileStem(path), path },
    scope: { kind: "section", heading },
  };
}

export const outlineKind: KindExtractor<"outline"> = (type, context) => {
  const { min_level, max_level } = type.source;
  const anchors: EntityAnchor[] = [];
  const violations: ExtractViolation[] = [];
  for (const path of outlineDocumentPaths(type.source, context)) {
    const document = context.readDocument(path);
    // 개체로 읽을 수 없는 문서는 개체를 만들지 않고 unreadable 위반으로 센다.
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
      if (heading.level < min_level || heading.level > max_level) continue;
      anchors.push(headingAnchor(type.name, path, heading));
    }
  }
  return { anchors, violations };
};
