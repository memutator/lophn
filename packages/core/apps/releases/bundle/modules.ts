// bundle에 담을 준비 폴더의 file을 읽는다. `node_modules`는 npm이 만든 그대로, `.lophn/sdk`는 앱
// package.json이 거는 설치 사본이다. symlink는 복사하지 않고 목록 file(links.ts)로 남긴다(bundle은 정규
// file만 담고, 가리키는 실제 폴더도 사본 안에 있다). 실행할 때 필요 없는 도구 file(.bin, npm의 설치 표시)은 뺀다.
import { readdir, readFile, readlink, stat } from "node:fs/promises";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { type BundleLink, encodeLinks, LINKS_PATH } from "./links.ts";

export type BundleFile = { path: string; bytes: Uint8Array };

type Unreadable = { code: "unavailable"; reason: string };

const SKIP = new Set([".bin", ".package-lock.json"]);

async function collect(
  directory: string,
  prefix: string,
  files: BundleFile[],
  links: BundleLink[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    const bundlePath = `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      links.push({ path: bundlePath, target: await readlink(path) });
    } else if (entry.isDirectory()) {
      await collect(path, bundlePath, files, links);
    } else if (entry.isFile()) {
      files.push({ path: bundlePath, bytes: await readFile(path) });
    }
  }
}

// folder가 없으면 빈 목록이다. 의존이 없는 앱은 node_modules나 sdk 사본이 없다.
async function readTree(
  folder: string,
  prefix: string,
  reason: string,
): Promise<Result<BundleFile[], Unreadable>> {
  const found = await stat(folder).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (!found) return ok([]);
  const files: BundleFile[] = [];
  const links: BundleLink[] = [];
  try {
    await collect(folder, prefix, files, links);
  } catch {
    return err({ code: "unavailable", reason });
  }
  if (links.length > 0) {
    files.push({ path: LINKS_PATH, bytes: encodeLinks(links) });
  }
  return ok(files.sort((a, b) => (a.path < b.path ? -1 : 1)));
}

export function readModules(
  staging: string,
): Promise<Result<BundleFile[], Unreadable>> {
  return readTree(
    `${staging}/node_modules`,
    "node_modules",
    "modules_unreadable",
  );
}

export function readSdkCopies(
  staging: string,
): Promise<Result<BundleFile[], Unreadable>> {
  return readTree(`${staging}/.lophn/sdk`, ".lophn/sdk", "sdk_unreadable");
}
