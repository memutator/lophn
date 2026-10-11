import type { KindExtractor } from "./types.ts";

export const appDataKind: KindExtractor<"app-data"> = (_type, _context) => ({
  anchors: [],
  violations: [],
});
