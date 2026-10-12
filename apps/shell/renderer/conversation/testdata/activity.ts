// tool 줄·편집 카드·진행 chip test의 fake. 값은 run trace(ReadAgentTrace)에서 그린 화면 값이다.
import type { EditView, TaskView, ToolLineView } from "../activity/model.ts";

export const READ_TOOL: ToolLineView = {
  id: "tcl_01h455vb4pex5v6nkc6gd5f001",
  label: "Read 3 documents",
  lines: [
    "docs/reports/2026-w38.md",
    "docs/reports/2026-w39.md",
    "eval/findings.md",
  ],
};

export const REPORT_EDIT: EditView = {
  id: "edit-1",
  document: "doc_01h455vb4pex5v6nkc6gd5f001",
  path: "docs/reports/2026-w40.md",
  added: 24,
  removed: 3,
};

/** 2/4: 둘 끝남, 하나 지금, 하나 남음. */
export const TASKS: readonly TaskView[] = [
  { id: "task-1", text: "Read last week's findings", state: "done" },
  { id: "task-2", text: "Search eval", state: "done" },
  { id: "task-3", text: "Write report", state: "now" },
  { id: "task-4", text: "Link findings", state: "later" },
];
