// 준비가 받아 둔 npm·jsr 사본을 bundle 파일로 읽는다. `deno cache`가 작업 폴더에 만든 `vendor/`(jsr)와
// `node_modules/`(npm)를 그대로 담는다. node_modules의 symlink는 가리키는 폴더를 그 자리에 복사해서 푼다
// (bundle은 정규 파일만 담는다). 실행할 때 필요 없는 도구 파일(.bin, 설치 표시, lock)은 뺀다.
import { err, ok, type Result } from "../../../../base/mod.ts";

type VendorFile = { path: string; bytes: Uint8Array };

const SKIP = new Set([
  ".bin",
  ".initialized",
  ".setup-cache.bin",
  ".deno.lock",
]);
// symlink가 서로를 가리키는 고리를 끊는다.
const MAX_DEPTH = 40;

async function collect(
  directory: string,
  prefix: string,
  files: VendorFile[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error("vendor tree is too deep");
  for await (const entry of Deno.readDir(directory)) {
    if (SKIP.has(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    const info = await Deno.stat(path);
    if (info.isDirectory) {
      await collect(path, `${prefix}/${entry.name}`, files, depth + 1);
    } else if (info.isFile) {
      files.push({
        path: `${prefix}/${entry.name}`,
        bytes: await Deno.readFile(path),
      });
    }
  }
}

export async function readVendorFiles(
  root: string,
): Promise<Result<VendorFile[], { code: "unavailable"; reason: string }>> {
  const files: VendorFile[] = [];
  try {
    for (const name of ["vendor", "node_modules"]) {
      const found = await Deno.stat(`${root}/${name}`).then(
        (info) => info.isDirectory,
        () => false,
      );
      if (found) await collect(`${root}/${name}`, name, files, 0);
    }
  } catch {
    return err({ code: "unavailable", reason: "vendor_unreadable" });
  }
  return ok(files.sort((a, b) => (a.path < b.path ? -1 : 1)));
}
