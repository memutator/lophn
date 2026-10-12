// 시각 블록 시험이 함께 쓰는 값. 제품 코드와 mod.ts는 import하지 않는다.
const ulid = "01arz3ndektsv4rrffq69g5fav";
export const msg = `msg_${ulid}`;
export const ses = `ses_${ulid}`;
export const run = `run_${ulid}`;
export const doc = `doc_${ulid}`;
export const ver = `ver_${ulid}`;
export const tcl = `tcl_${ulid}`;
export const app = `app_${ulid}`;
export const rel = `rel_${ulid}`;
export const at = "2026-10-04T00:00:00.000Z";
export const later = "2026-10-04T01:00:00.000Z";

export const tableBlock = {
  key: "counts",
  schema_version: 1,
  kind: "table",
  title: "counts",
  description: "observed counts",
  sources: [{
    kind: "document",
    reference: { document: doc, version: ver },
    observed_at: null,
  }],
  payload: {
    columns: [{ key: "name", label: "name", type: "string" }],
    rows: [{ name: "a" }],
  },
} as const;

export const chartBlock = {
  ...tableBlock,
  key: "trend",
  kind: "chart",
  payload: {
    type: "line",
    x: { label: "when", type: "time" },
    y: { label: "n" },
    series: [{
      key: "s",
      label: "s",
      points: [{ x: at, y: 1 }, { x: later, y: null }],
    }],
  },
} as const;
