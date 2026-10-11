// 계약의 Source가 Project 파일 경로 하나를 덮는지. context.containing이 쓴다.
import type { ContractSource } from "../../../contracts/documents/mod.ts";
import { matcherFor } from "../extract/docs-paths.ts";
import { listMembers, parsePattern } from "../series/next.ts";

export function sourceCovers(source: ContractSource, path: string): boolean {
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
      // from_type은 다른 type의 개체 문서를 따라가므로 계약만으로는 경로를 알 수 없다.
      return source.documents?.some((pattern) => matcherFor(pattern)(path)) ??
        false;
    case "app-data":
      return false;
  }
}
