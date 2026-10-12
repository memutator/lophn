import { matcherFor } from "./docs-paths.ts";
import type { EntityAnchor, KindExtractor } from "./types.ts";

// 맞는 문서 하나가 개체 하나다. 여러 패턴에 맞아도 한 번만 낸다.
// 순서는 Project 파일 경로의 code unit 순(paths()가 이미 그 순서다).
// 문서 글은 읽지 않는다. 경로만 보고 개체의 자리를 정한다.
export const docsKind: KindExtractor<"docs"> = (type, context) => {
  const matchers = type.source.paths.map(matcherFor);
  const anchors: EntityAnchor[] = context.files
    .paths()
    .filter((path) => matchers.some((matches) => matches(path)))
    .map((path) => ({
      type: type.name,
      path,
      section: null,
      captures: { file: fileStem(path), path },
      scope: { kind: "document" },
    }));
  return { anchors, violations: [] };
};

// 파일 이름에서 확장자를 뺀 값. 마지막 `.` 앞이고, 맨 앞 `.`만 있는 이름(`.env`)은 그대로 둔다.
function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
