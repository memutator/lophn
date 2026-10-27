// bundle 안 symlink 목록. npm package는 `node_modules/<이름>`을 `.deno/` 안 실제 폴더로 잇는 symlink로 깔리는데,
// bundle은 정규 file만 담으므로 vendor.ts가 이 목록 file 하나로 굳히고 seal.ts가 사본에서 다시 만든다.
// 내려받은 package가 만든 연결이 사본 밖을 가리키면 앱 process의 읽기 허락을 우회하므로 읽을 때 거절한다.
import { mkdir, symlink } from "node:fs/promises";

import { err, ok, type Result } from "../../../../base/mod.ts";
import { relativePathSchema } from "../../../../protocol/projects/mod.ts";

export const LINKS_PATH = "node_modules/.lophn-links.json";

export type VendorLink = { path: string; target: string };

type LinkFailure = { code: "invalid_input"; message: string };

export function encodeLinks(links: readonly VendorLink[]): Uint8Array {
  const sorted = [...links].sort((a, b) => (a.path < b.path ? -1 : 1));
  return new TextEncoder().encode(JSON.stringify(sorted));
}

function invalid(message: string): Result<never, LinkFailure> {
  return err({ code: "invalid_input", message });
}

// target의 `..`는 앞에만 둘 수 있다. 중간 `..`는 중간 symlink를 거치면 글자 계산과 실제가 달라진다.
function targetStaysInside(path: string, target: string): boolean {
  if (target === "" || target.startsWith("/") || /[\\\p{Cc}]/u.test(target)) {
    return false;
  }
  const parts = target.split("/");
  let up = 0;
  while (parts[up] === "..") up += 1;
  if (
    parts.slice(up).some((part) => part === "" || part === "." || part === "..")
  ) {
    return false;
  }
  const depth = path.split("/").length - 1;
  return up <= depth && parts.length > up;
}

export function decodeLinks(
  bytes: Uint8Array,
): Result<VendorLink[], LinkFailure> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return invalid("bundle links file is not JSON");
  }
  if (!Array.isArray(parsed)) return invalid("bundle links file is not a list");
  const links: VendorLink[] = [];
  for (const item of parsed) {
    const path = item?.path;
    const target = item?.target;
    if (typeof path !== "string" || typeof target !== "string") {
      return invalid("bundle link needs a path and a target");
    }
    if (
      !relativePathSchema.safeParse(path).success ||
      !(path.startsWith("node_modules/") || path.startsWith("vendor/"))
    ) {
      return invalid("bundle link path is outside node_modules and vendor");
    }
    if (!targetStaysInside(path, target)) {
      return invalid("bundle link target leaves the copy");
    }
    links.push({ path, target });
  }
  // 연결 아래에 연결을 만들면 mkdir이 연결을 따라가 사본 밖으로 나갈 수 있다.
  const paths = new Set(links.map((link) => link.path));
  for (const link of links) {
    const parts = link.path.split("/");
    for (let end = 1; end < parts.length; end += 1) {
      if (paths.has(parts.slice(0, end).join("/"))) {
        return invalid("bundle link is under another link");
      }
    }
  }
  return ok(links);
}

// 연결을 만든다. 부모 폴더는 이미 열려 있는 사본 안에서 만든다.
export async function createLinks(
  copyPath: string,
  links: readonly VendorLink[],
): Promise<void> {
  for (const link of links) {
    const path = `${copyPath}/${link.path}`;
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await symlink(link.target, path);
  }
}
