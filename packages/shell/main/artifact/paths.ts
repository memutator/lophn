// 봉한 scheme의 path 해석. Electron 없이 node:fs만 쓴다.
import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

export const ARTIFACT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * 요청 path를 root 안의 실제 file 자리로 푼다. `root`는 호출하는 쪽이 realpath한 값이다.
 * 어휘 검사(`..`·절대 path)와 realpath 검사(symlink 탈출)가 둘 다 있어야 한다.
 * 접두사만 같은 형제 폴더(`/x/art-evil`)가 안으로 보이지 않도록 root에 sep를 붙여 비교한다.
 */
export async function resolveInsideRoot(
  root: string,
  urlPath: string,
): Promise<{ absolute: string; relative: string } | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  // 절대 path처럼 보이는 요청도 root 안 path가 될 뿐이다.
  const relative = decoded.replace(/^\/+/, "");
  if (relative === "" || relative.split("/").includes("..")) return null;
  const inside = root.endsWith(sep) ? root : root + sep;
  if (!resolve(root, relative).startsWith(inside)) return null;
  try {
    const absolute = await realpath(resolve(root, relative));
    return absolute.startsWith(inside) ? { absolute, relative } : null;
  } catch {
    return null;
  }
}
