export const id = "01arz3ndektsv4rrffq69g5fav";
export const msg = `msg_${id}`;
export const msg2 = "msg_01arz3ndektsv4rrffq69g5faw";
export const ses = `ses_${id}`;
export const run = `run_${id}`;
export const run2 = "run_01arz3ndektsv4rrffq69g5faw";
export const asg = `asg_${id}`;
export const doc = `doc_${id}`;
export const ver = `ver_${id}`;
export const qst = `qst_${id}`;
export const apr = `apr_${id}`;
export const mcl = `mcl_${id}`;
export const tcl = `tcl_${id}`;
export const app = `app_${id}`;
export const rel = `rel_${id}`;
export const body = "ab".repeat(32);
export const content = {
  schema_version: 1,
  parts: [{ kind: "text", text: "hello" }],
} as const;
export const at = "2026-10-04T00:00:00.000Z";
export const later = "2026-10-04T01:00:00.000Z";
export const latest = "2026-10-04T02:00:00.000Z";

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
