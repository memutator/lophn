// series source: pattern에 맞는 문서가 개체다(documents/contexts 추출 규칙, documents/series).
// 문법과 멤버 목록은 series/next.ts를 그대로 쓴다.
import {
  listMembers,
  parsePattern,
  type SeriesPattern,
} from "../series/next.ts";
import type {
  EntityAnchor,
  ExtractViolation,
  KindExtractor,
  KindResult,
} from "./types.ts";

// 마지막 "." 뒤 글자까지(점 포함). 점이 없으면 "".
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}

// pattern이 가리키는 폴더 바로 아래 파일의 경로 조각(폴더 prefix 뒤 이름). 하위 폴더면 null.
function nameInFolder(pattern: SeriesPattern, path: string): string | null {
  const prefix = pattern.folders.map((folder) => `${folder}/`).join("");
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  return name === "" || name.includes("/") ? null : name;
}

export const seriesKind: KindExtractor<"series"> = (type, context) => {
  const parsed = parsePattern(type.source.pattern);
  // 문법 위반은 계약 검증이 잡는다. 여기서는 개체가 없다.
  if (!parsed.ok) return { anchors: [], violations: [] };
  const pattern = parsed.value;
  const paths = context.files.paths();

  const members = listMembers(pattern, paths);
  const anchors: EntityAnchor[] = members.map((member) => ({
    type: type.name,
    path: member.path,
    section: null,
    captures: {
      [pattern.part]: member.key,
      file: member.path.slice(member.path.lastIndexOf("/") + 1).replace(
        /\.[^.]+$/,
        "",
      ),
      path: member.path,
    },
    scope: { kind: "document" },
  }));

  const memberPaths = new Set(members.map((member) => member.path));
  const extension = extensionOf(pattern.after);
  const violations: ExtractViolation[] = [];
  for (const path of paths) {
    if (memberPaths.has(path)) continue;
    const name = nameInFolder(pattern, path);
    if (name === null || extensionOf(name) !== extension) continue;
    violations.push({
      kind: "path_mismatch",
      rule: null,
      type: type.name,
      path,
      section: null,
      target: null,
    });
  }

  return { anchors, violations } satisfies KindResult;
};
