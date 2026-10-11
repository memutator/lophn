import type { Contract } from "../../../contracts/documents/mod.ts";
import type { WatchFolder } from "./types.ts";

// 계약이 가리키는 경로가 든 폴더의 집합. 규칙:
// - docs·section·outline(documents)의 glob, series의 pattern은 파일 이름 칸 앞의 literal 폴더
//   칸이 그 폴더다. 그 뒤에 glob 폴더 칸(`**`, `a/*/x.md`의 `*`)이 있으면 recursive다.
// - folder source는 root가 recursive 폴더다(하위 폴더가 생기고 없어지는 것이 개체이므로).
// - index source는 그 문서가 든 폴더, 루트의 파일은 path ""다.
// - from_type으로 문서를 받는 section·outline과 app-data는 폴더를 더하지 않는다.
// - recursive 폴더 아래에 든 폴더는 합쳐서 지운다. 같은 폴더가 둘이면 recursive가 이긴다.
// 결과는 path의 code unit 순이다.
export function watchFolders(_contract: Contract): WatchFolder[] {
  throw new Error("not implemented");
}

// folder가 path(Project 기준 파일 경로)를 덮는가.
// recursive가 아니면 path의 부모 폴더가 folder와 같을 때, recursive면 folder 아래 어디든이다.
export function folderCovers(_folder: WatchFolder, _path: string): boolean {
  throw new Error("not implemented");
}
