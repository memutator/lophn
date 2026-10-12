// 계약의 Source가 Project 파일 경로 하나를 덮는지. context.containing이 쓴다.
import type {
  ContractSource,
  ContractType,
} from "../../../protocol/projects/mod.ts";
import { matcherFor } from "../extract/docs-paths.ts";
import { listMembers, parsePattern } from "../series/next.ts";

// `types`는 같은 계약의 type들이다. section·outline이 `from_type`으로 읽는 문서는 그 type 개체의 문서이므로,
// 그 type의 Source가 문서로 덮는 경로가 곧 이 Source가 읽는 경로다(도는 참조는 덮지 않는 것으로 본다).
export function sourceCovers(
  source: ContractSource,
  path: string,
  types: readonly ContractType[] = [],
  following: ReadonlySet<string> = new Set(),
): boolean {
  switch (source.kind) {
    case "folder": {
      // 하위 폴더 하나가 개체이고, 그 폴더 안의 파일이 개체의 자료다.
      const prefix = `${source.root}/`;
      if (!path.startsWith(prefix)) return false;
      const rest = path.slice(prefix.length).split("/");
      return rest.length >= 2 && matcherFor(source.child_pattern)(rest[0]!);
    }
    case "docs":
      return source.paths.some((pattern) => matcherFor(pattern)(path));
    case "series": {
      const pattern = parsePattern(source.pattern);
      return pattern.ok && listMembers(pattern.value, [path]).length > 0;
    }
    case "index":
      return source.document === path;
    case "section":
    case "outline":
      if (source.from_type === undefined) {
        return source.documents?.some((pattern) => matcherFor(pattern)(path)) ??
          false;
      }
      return coversThroughType(source.from_type, path, types, following);
    case "app-data":
      return false;
  }
}

// from_type이 가리키는 type의 개체 문서 중 이 경로가 있는지. folder(개체가 폴더)·index(개체가 링크가 가리키는
// 문서)·app-data(파일이 없음)는 계약만으로 개체의 문서를 알 수 없어 덮지 않는 것으로 본다.
function coversThroughType(
  name: string,
  path: string,
  types: readonly ContractType[],
  following: ReadonlySet<string>,
): boolean {
  const type = types.find((candidate) => candidate.name === name);
  if (type === undefined || following.has(name)) return false;
  const kind = type.source.kind;
  if (kind === "folder" || kind === "index" || kind === "app-data") {
    return false;
  }
  return sourceCovers(type.source, path, types, new Set([...following, name]));
}
