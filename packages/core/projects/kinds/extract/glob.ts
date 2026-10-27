// glob을 domain 그릇의 파일 경로에 맞춘다. glob이 아니면 경로가 정확히 같아야 한다.
import picomatch from "picomatch";
import type { Kind } from "../../../../protocol/projects/mod.ts";

// `*`는 한 폴더 안, `**`는 여러 폴더, `?`는 한 글자다.
const GLOB_OPTIONS = { dot: true, fastpaths: false, windows: false } as const;

type PathMatcher = (path: string) => boolean;

export function matcherFor(pattern: string): PathMatcher {
  // 글자 그대로의 경로(괄호 같은 문자 포함)는 glob으로 풀지 않고 그대로 비교한다.
  if (!picomatch.scan(pattern).isGlob) return (path) => path === pattern;
  const regex = picomatch.makeRe(pattern, GLOB_OPTIONS);
  return (path) => regex.test(path);
}

// 경로에 glob이 맞는 kind들(kinds 순서).
export function kindMatcher(kinds: readonly Kind[]): (path: string) => Kind[] {
  const compiled = kinds.map((kind) => ({
    kind,
    tests: kind.files.map(matcherFor),
  }));
  return (path) =>
    compiled
      .filter(({ tests }) => tests.some((test) => test(path)))
      .map(({ kind }) => kind);
}
