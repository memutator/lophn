import type { KindExtractor } from "./types.ts";

export const folderKind: KindExtractor<"folder"> = (_type, _context) => ({
  anchors: [],
  violations: [],
});
