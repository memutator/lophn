import { readFile, realpath, stat } from "node:fs/promises";
import type { BundleLocator } from "../ports.ts";
import type { ScreenFileDeps } from "./serve.ts";

export function createScreenFileDeps(
  bundles: BundleLocator,
  maxBytes?: number,
): ScreenFileDeps {
  return { bundles, ...createFileReads(maxBytes) };
}

// 폴더 아래 file 읽기(serveFileUnder)의 node fs 구현이다.
export function createFileReads(
  maxBytes?: number,
): Omit<ScreenFileDeps, "bundles"> {
  return {
    maxBytes,
    async realPath(path) {
      try {
        return await realpath(path);
      } catch {
        return null;
      }
    },
    async readFile(path, maxBytes) {
      try {
        const info = await stat(path);
        if (!info.isFile() || info.size > maxBytes) return null;
        return await readFile(path);
      } catch {
        return null;
      }
    },
  };
}
