import type { KindExtractor } from "./types.ts";

export const seriesKind: KindExtractor<"series"> = (_type, _context) => ({
  anchors: [],
  violations: [],
});
