// 준비가 받아 둔 npm·jsr 사본을 bundle 파일로 읽는다. `deno cache`가 작업 폴더에 만든 `vendor/`(jsr)와
// `node_modules/`(npm)를 그대로 담는다. symlink는 복사하지 않고 목록 file(links.ts)로 남긴다
// (bundle은 정규 파일만 담고, 가리키는 실제 폴더는 `.deno/` 안에 한 벌 있다).
// 실행할 때 필요 없는 도구 파일(.bin, 설치 표시, lock)은 뺀다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { encodeLinks, LINKS_PATH, type VendorLink } from "./links.ts";

type VendorFile = { path: string; bytes: Uint8Array };

const SKIP = new Set([
  ".bin",
  ".initialized",
  ".setup-cache.bin",
  ".deno.lock",
]);

async function collect(
  directory: string,
  prefix: string,
  files: VendorFile[],
  links: VendorLink[],
): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    if (SKIP.has(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    const bundlePath = `${prefix}/${entry.name}`;
    if (entry.isSymlink) {
      links.push({ path: bundlePath, target: await Deno.readLink(path) });
    } else if (entry.isDirectory) {
      await collect(path, bundlePath, files, links);
    } else if (entry.isFile) {
      files.push({ path: bundlePath, bytes: await Deno.readFile(path) });
    }
  }
}

export async function readVendorFiles(
  root: string,
): Promise<Result<VendorFile[], { code: "unavailable"; reason: string }>> {
  const files: VendorFile[] = [];
  const links: VendorLink[] = [];
  try {
    for (const name of ["vendor", "node_modules"]) {
      const found = await Deno.stat(`${root}/${name}`).then(
        (info) => info.isDirectory,
        () => false,
      );
      if (found) await collect(`${root}/${name}`, name, files, links);
    }
  } catch {
    return err({ code: "unavailable", reason: "vendor_unreadable" });
  }
  if (links.length > 0) {
    files.push({ path: LINKS_PATH, bytes: encodeLinks(links) });
  }
  return ok(files.sort((a, b) => (a.path < b.path ? -1 : 1)));
}
