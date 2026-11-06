// grant scope의 경로 판정. 파일 시스템 접근은 adapter에만 있고 여기는 결과를 받아 판정한다.
import { posix, win32 } from "node:path";
import process from "node:process";
import type { OsPlatform } from "../../../base/mod.ts";

export type PathResolver = {
  // ~ 와 상대 경로를 포함한 입력을 실제 절대 경로로 푼다. 실패하면 undefined.
  realPath(path: string): Promise<string | undefined>;
  isDirectory(path: string): Promise<boolean>;
  // 폴더 안의 lexical link와 그 대상의 실제 경로. 대상을 못 풀면 target은 undefined.
  linksIn(directory: string): Promise<{ link: string; target?: string }[]>;
};

// descendant는 실제 경로의 경로 구성요소 관계다. 문자열 prefix는 쓰지 않는다.
// win32와 darwin의 file system은 대소문자를 가리지 않는 것이 기본이라 같은 경로로 본다.
export function isSameOrInside(
  path: string,
  root: string,
  platform: OsPlatform = process.platform,
): boolean {
  const flavor = platform === "win32" ? win32 : posix;
  const fold = (value: string) =>
    platform === "win32" || platform === "darwin" ? value.toLowerCase() : value;
  const inside = flavor.relative(fold(root), fold(path));
  return (
    inside === "" ||
    (inside !== ".." &&
      !inside.startsWith(`..${flavor.sep}`) &&
      !flavor.isAbsolute(inside))
  );
}
