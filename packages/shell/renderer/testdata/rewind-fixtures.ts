// Agent view core source의 되돌리기 test fixture. 값은 lophn-agent/revert contract(reverts.ts)가 낸 모양이고
// contractCore가 응답을 output schema로 검사한다.
import { id, SESSION } from "./agent-core-fixtures.ts";
import { META } from "./contract-core.ts";

const HASH = "b".repeat(64);

/** `rewind/checkpoints`의 항목. 메시지 n의 checkpoint다. */
export function checkpointEntry(
  n: number,
  over: Record<string, unknown> = {},
  created = 20 + n,
): Record<string, unknown> {
  return {
    message: id("msg", n),
    session: SESSION,
    files_restorable: true,
    files_reason: null,
    created_seq: String(created),
    hidden: false,
    ...over,
  };
}

/** 사전 검사 항목 하나(복원/건너뜀/남음). */
export function previewItem(
  ordinal: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ordinal,
    class: "file",
    target: `notes/${ordinal}.md`,
    source: [id("tcl", 5)],
    plan: "restore",
    reason: null,
    app_revert: null,
    ...over,
  };
}

/** `rewind/preview`의 응답. */
export function previewBody(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "rewind",
    choice: "messages_only",
    checkpoint: id("msg", 3),
    tool_call: null,
    restore: [],
    skip: [],
    remain: [],
    redo: true,
    preview_hash: HASH,
    ...META,
    ...over,
  };
}

/** Undo의 사전 검사 응답. */
export function undoPreviewBody(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return previewBody({
    kind: "undo",
    choice: null,
    checkpoint: null,
    tool_call: id("tcl", 5),
    redo: false,
    ...over,
  });
}

/** `rewind/list`의 한 rewind. 기본은 메시지 3에서 적용된 messages only이고 redo를 할 수 있다. */
export function revertRecord(
  n: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: id("rvt", n),
    session: SESSION,
    kind: "rewind",
    choice: "messages_only",
    checkpoint: id("msg", 3),
    tool_call: null,
    boundary_seq: "31",
    summary_call: null,
    outcome: "applied",
    redo: "available",
    items: [],
    preview_hash: HASH,
    result_seq: "40",
    ...over,
  };
}

/** 편집 카드를 되돌린 Undo 한 번. */
export function undoRecord(
  n: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return revertRecord(n, {
    kind: "undo",
    choice: null,
    checkpoint: null,
    tool_call: id("tcl", 5),
    boundary_seq: null,
    redo: "none",
    items: [previewItem(0, { result: "restored" })],
    result_seq: "41",
    ...over,
  });
}
