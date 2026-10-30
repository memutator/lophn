import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

type Folder = { folder_ref: string; path: string };

// renderer가 보낸 시작 폴더가 등록 폴더 안인지 main이 다시 본다. symlink로 밖에 닿는 경로를 막으려고 realpath로 비교한다.
export function folderOfCwd(
  folders: readonly Folder[],
  cwd: string,
): { ok: true; folder_ref: string; path: string } | { ok: false } {
  let real: string;
  try {
    real = realpathSync(cwd);
  } catch {
    return { ok: false };
  }
  for (const folder of folders) {
    let root: string;
    try {
      root = realpathSync(folder.path);
    } catch {
      continue;
    }
    const inside = relative(root, real);
    if (
      inside === "" ||
      (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
    ) {
      return { ok: true, folder_ref: folder.folder_ref, path: cwd };
    }
  }
  return { ok: false };
}
