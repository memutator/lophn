import type { KindExtractor } from "./types.ts";

export const indexKind: KindExtractor<"index"> = (_type, _context) => ({
  anchors: [],
  violations: [],
});
