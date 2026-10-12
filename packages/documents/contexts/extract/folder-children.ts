// 폴더는 파일 경로에서만 안다. root 바로 아래 하위 폴더 이름(depth 1)을 code unit 순으로 낸다.
// root 바로 아래에 있는 파일(`runs/readme.md`)은 폴더가 아니다. root 아래 더 깊은 폴더
// (`runs/a/b/c.md`의 `b`)는 이름으로 넣지 않는다.
export function childFolderNames(
  paths: readonly string[],
  root: string,
): string[] {
  const prefix = `${root}/`;
  const names = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    // root 바로 아래 파일이다. 폴더 이름이 없다.
    if (slash === -1) continue;
    names.add(rest.slice(0, slash));
  }
  // 기본 정렬은 code unit 순이다. 같은 root 아래라서 이름 순이 경로 순과 같다.
  return [...names].sort();
}
