import type { KindExtractor } from "./types.ts";

export const docsKind: KindExtractor<"docs"> = (_type, _context) => ({
  anchors: [],
  violations: [],
});
