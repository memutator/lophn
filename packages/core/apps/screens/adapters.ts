import { readFile, realpath, stat } from "node:fs/promises";
import type { BundleLocator } from "../ports.ts";
import type { ScreenFileDeps } from "./serve.ts";

export function createScreenFileDeps(
  bundles: BundleLocator,
  maxBytes?: number,
): ScreenFileDeps {
  return {
    bundles,
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
