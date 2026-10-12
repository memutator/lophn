// index source: 문서가 링크한 같은 Project 문서 하나가 개체 하나다(링크 순서).
// 규칙은 docs/domain-model/documents/contexts.md의 "추출 규칙".
import { markdownLinks } from "./links.ts";
import type { EntityAnchor, ExtractViolation, KindExtractor } from "./types.ts";

export const indexKind: KindExtractor<"index"> = (type, context) => {
  const { document: indexPath, within } = type.source;
  const violation = (
    kind: ExtractViolation["kind"],
    target: string | null,
  ): ExtractViolation => ({
    kind,
    rule: null,
    type: type.name,
    path: indexPath,
    section: null,
    target,
  });

  const document = context.readDocument(indexPath);
  if (document === null) {
    return { anchors: [], violations: [violation("unreadable", null)] };
  }

  const existing = new Set(context.files.paths());
  const seen = new Set<string>();
  const anchors: EntityAnchor[] = [];
  const violations: ExtractViolation[] = [];
  for (const link of markdownLinks(indexPath, document, within)) {
    // 같은 문서를 여러 번 링크해도 개체와 위반은 한 번이다
    if (seen.has(link.target)) continue;
    seen.add(link.target);
    if (!link.inside || !existing.has(link.target)) {
      violations.push(violation("broken_link", link.target));
      continue;
    }
    anchors.push({
      type: type.name,
      path: link.target,
      section: null,
      captures: {
        file: link.target.slice(link.target.lastIndexOf("/") + 1).replace(
          /\.[^.]+$/,
          "",
        ),
        path: link.target,
      },
      scope: { kind: "document" },
    });
  }
  return { anchors, violations };
};
