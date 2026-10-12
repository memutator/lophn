import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { FileStat } from "./judge.ts";

// 문서 파일 복원의 동기 관측이다. reader Worker의 preview 읽기가 쓴다. 동기 file
// API가 core graph에 들어오지 않도록 이 모듈은 core가 import하지 않는다. 비동기 관측·준비·설치는
// restore.ts에 있고 여기서 함께 내보낸다. 순서는 observeFiles → prepareRestore → (Rewind command) →
// installRestore다.
export {
  installRedo,
  installRestore,
  type InstallResult,
  observeFilesAsync,
  prepareRestore,
} from "./restore.ts";

const GONE: FileStat = { exists: false, sha256: null, link: false };
const LINKED: FileStat = { exists: true, sha256: null, link: true };

function missing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

// root 안의 경로인가. 이미 있는 가장 가까운 상위 폴더의 실제 경로가 root 밖이면(상위 폴더가 symlink)
// root 밖이다.
function insideRoot(root: string, full: string): boolean {
  const outside = relative(root, full);
  if (outside === "" || outside.startsWith("..") || isAbsolute(outside)) {
    return false;
  }
  const realRoot = realpathSync(root);
  let probe = dirname(full);
  for (;;) {
    try {
      const real = realpathSync(probe);
      return real === realRoot || real.startsWith(realRoot + sep);
    } catch (error) {
      if (!missing(error)) throw error;
      const parent = dirname(probe);
      if (parent === probe) throw error;
      probe = parent;
    }
  }
}

// 경로마다 지금 상태를 본다. symlink(lstat)이거나 hard link(nlink > 1)면 link=true다. 없는 경로는
// exists=false다. 내용은 sha256(hex)이다.
export function observeFiles(
  root: string,
  paths: readonly string[],
): Map<string, FileStat> {
  const seen = new Map<string, FileStat>();
  for (const path of paths) {
    const full = join(root, path);
    let stat: FileStat;
    try {
      if (!insideRoot(root, full)) {
        stat = LINKED;
      } else {
        const info = lstatSync(full);
        stat = !info.isFile() || info.nlink > 1 ? LINKED : {
          exists: true,
          sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
          link: false,
        };
      }
    } catch (error) {
      if (!missing(error)) throw error;
      stat = GONE;
    }
    seen.set(path, stat);
  }
  return seen;
}
