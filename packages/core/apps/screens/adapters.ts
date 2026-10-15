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
        return await Deno.realPath(path);
      } catch {
        return null;
      }
    },
    async readFile(path, maxBytes) {
      try {
        const info = await Deno.stat(path);
        if (!info.isFile || info.size > maxBytes) return null;
        return await Deno.readFile(path);
      } catch {
        return null;
      }
    },
  };
}
