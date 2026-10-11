import type { KindExtractor } from "./types.ts";

export const outlineKind: KindExtractor<"outline"> = (_type, _context) => ({
  anchors: [],
  violations: [],
});
