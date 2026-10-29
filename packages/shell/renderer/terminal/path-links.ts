// 터미널 출력 한 줄에서 파일 경로(`src/a.ts:12:3`, `./x.md`, `/abs/y.ts`)를 찾는다. 확장자가 있는 것만 본다.
// 낱말마다 link가 생기지 않게 하려는 것이고, 파일이 실제로 있는지는 여는 쪽이 디스크에서 본다.

export interface PathMatch {
  /** 글 안 시작 index와 끝(포함하지 않음). `:line:col`까지 덮는다. */
  readonly start: number;
  readonly end: number;
  readonly path: string;
  readonly line?: number;
}

// 앞이 경로 글자나 `:`(URL의 `https://`)이면 경로의 중간이라 시작으로 보지 않는다. 이름 글자는 Unicode 글자·숫자다.
const PATH =
  /(?<![\p{L}\p{N}_./~:@+-])((?:\.{1,2}\/|\/)?(?:[\p{L}\p{N}_@+-][\p{L}\p{N}_.@+-]*\/)*[\p{L}\p{N}_@+-][\p{L}\p{N}_.@+-]*\.[A-Za-z][A-Za-z0-9]*)(?::(\d+)(?::\d+)?)?/gu;

export function pathMatches(text: string): PathMatch[] {
  const found: PathMatch[] = [];
  for (const match of text.matchAll(PATH)) {
    const path = match[1]!;
    const line = match[2] === undefined ? undefined : Number(match[2]);
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      path,
      ...(line === undefined || line < 1 ? {} : { line }),
    });
  }
  return found;
}

/** 터미널 기준 폴더(`cwd`)로 절대 경로를 만든다. `..`와 `.`은 접는다. */
export function resolvePath(path: string, cwd: string): string {
  const parts: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${cwd}/${path}`).split(
    "/",
  )) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}
