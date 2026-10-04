// 파일 시스템 접근은 이 adapter에만 둔다. commands는 결과를 받아 판정한다.

function isGitFolder(path: string): boolean {
  try {
    const entries = Array.from(Deno.readDirSync(path));
    // .git은 폴더(작업 폴더)와 file(bare 저장소·worktree gitfile) 모두 온다.
    return entries.some((entry) => entry.name === ".git");
  } catch {
    return false;
  }
}

// R4. 임의 위치의 git source 폴더를 연결하기 전 정규화한 실제 경로를 판정한다.
// 저장은 symlink·`..` 없는 실제 경로만 한다. 없거나 git 폴더가 아니면 undefined다.
export function resolveSourcePath(path: string): string | undefined {
  try {
    return isGitFolder(path) ? Deno.realPathSync(path) : undefined;
  } catch {
    return undefined;
  }
}
