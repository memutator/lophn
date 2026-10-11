import type { KindExtractor } from "./types.ts";

export const sectionKind: KindExtractor<"section"> = (_type, _context) => ({
  anchors: [],
  violations: [],
});
