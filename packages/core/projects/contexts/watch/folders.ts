import picomatch from "picomatch";
import type { Contract } from "../../../../protocol/projects/mod.ts";
import type { WatchFolder } from "./types.ts";

const isGlob = (segment: string) => picomatch.scan(segment).isGlob;

// glob 패턴이 가리키는 폴더. 파일 이름 칸(마지막)을 뺀 폴더 칸 중 처음 glob 칸 앞까지가 literal 폴더이고,
// glob 폴더 칸이나 `**` 이름 칸이 있으면 recursive다.
function folderOfPattern(pattern: string): WatchFolder {
  const segments = pattern.split("/");
  const name = segments.pop()!;
  const globAt = segments.findIndex(isGlob);
  if (globAt >= 0) {
    return { path: segments.slice(0, globAt).join("/"), recursive: true };
  }
  return { path: segments.join("/"), recursive: name === "**" };
}

function folderOfFile(path: string): WatchFolder {
  return {
    path: path.slice(0, Math.max(path.lastIndexOf("/"), 0)),
    recursive: false,
  };
}

function sourceFolders(source: Contract["types"][number]["source"]) {
  switch (source.kind) {
    case "folder":
      return [{ path: source.root, recursive: true }];
    case "docs":
      return source.paths.map(folderOfPattern);
    case "series":
      return [folderOfPattern(source.pattern)];
    case "index":
      return [folderOfFile(source.document)];
    case "section":
    case "outline":
      return (source.documents ?? []).map(folderOfPattern);
    case "app-data":
      return [];
  }
}

// 같은 폴더는 recursive가 이기고, recursive 폴더 아래에 든 폴더는 지운다. path의 code unit 순이다.
export function mergeFolders(folders: readonly WatchFolder[]): WatchFolder[] {
  const byPath = new Map<string, boolean>();
  for (const folder of folders) {
    byPath.set(
      folder.path,
      byPath.get(folder.path) === true || folder.recursive,
    );
  }
  const deep = [...byPath].filter(([, recursive]) => recursive).map(([path]) =>
    path
  );
  return [...byPath]
    .filter(([path]) =>
      !deep.some((root) =>
        root !== path && (root === "" || path.startsWith(`${root}/`))
      )
    )
    .map(([path, recursive]) => ({ path, recursive }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

// 계약이 가리키는 경로가 든 폴더의 집합. 규칙:
// - docs·section·outline(documents)의 glob, series의 pattern은 파일 이름 칸 앞의 literal 폴더
//   칸이 그 폴더다. 그 뒤에 glob 폴더 칸(`**`, `a/*/x.md`의 `*`)이 있으면 recursive다.
// - folder source는 root가 recursive 폴더다(하위 폴더가 생기고 없어지는 것이 개체이므로).
// - index source는 그 문서가 든 폴더, 루트의 파일은 path ""다.
// - from_type으로 문서를 받는 section·outline과 app-data는 폴더를 더하지 않는다.
// - recursive 폴더 아래에 든 폴더는 합쳐서 지운다. 같은 폴더가 둘이면 recursive가 이긴다.
// 결과는 path의 code unit 순이다.
export function watchFolders(contract: Contract): WatchFolder[] {
  return mergeFolders(
    contract.types.flatMap((type) => sourceFolders(type.source)),
  );
}

// folder가 path(Project 기준 파일 경로)를 덮는가.
// recursive가 아니면 path의 부모 폴더가 folder와 같을 때, recursive면 folder 아래 어디든이다.
export function folderCovers(folder: WatchFolder, path: string): boolean {
  if (!folder.recursive) return folderOfFile(path).path === folder.path;
  return folder.path === "" || path.startsWith(`${folder.path}/`);
}
