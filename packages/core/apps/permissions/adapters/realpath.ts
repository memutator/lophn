import { lstat, readdir, realpath, stat } from "node:fs/promises";

import { isSameOrInside, type PathResolver } from "../model.ts";

// 파일 시스템 접근은 이 adapter에만 둔다. model은 결과를 받아 판정한다.

async function real(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

async function walk(
  directory: string,
  found: { link: string; target?: string }[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      found.push({ link: path, target: await real(path) });
      continue;
    }
    if (entry.isDirectory()) await walk(path, found);
  }
}

export function realPathResolver(home: string, base: string): PathResolver {
  return {
    async realPath(path) {
      const expanded =
        path === "~"
          ? home
          : path.startsWith("~/")
            ? `${home}/${path.slice(2)}`
            : path;
      const absolute = expanded.startsWith("/")
        ? expanded
        : `${base}/${expanded}`;
      return await real(absolute);
    },
    async isDirectory(path) {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    },
    async linksIn(directory) {
      const root = await real(directory);
      if (root === undefined) return [];
      const found: { link: string; target?: string }[] = [];
      await walk(root, found);
      return found.filter(
        (item) =>
          item.target === undefined || !isSameOrInside(item.target, root),
      );
    },
  };
}
