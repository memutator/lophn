// outline source가 읽을 문서 경로 목록. from_type이면 그 type 개체의 문서(개체 순서),
// documents면 패턴에 맞는 Project 파일(경로 순서)이다. 같은 문서는 처음 나온 자리에서 한 번만 낸다.
import { matcherFor } from "./docs-paths.ts";
import type { KindContext, TypeOfKind } from "./types.ts";

export function outlineDocumentPaths(
  source: TypeOfKind<"outline">["source"],
  context: KindContext,
): string[] {
  if (source.from_type !== undefined) {
    const paths = context.anchorsOf(source.from_type).map((anchor) =>
      anchor.path
    );
    return [...new Set(paths)];
  }
  const matchers = (source.documents ?? []).map(matcherFor);
  return context.files.paths().filter((path) =>
    matchers.some((matches) => matches(path))
  );
}
