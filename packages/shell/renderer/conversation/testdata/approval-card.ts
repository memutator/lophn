// 승인 카드 test의 fake. 값은 platform/approvals 요청(GetApproval, ReadApprovalText)에서 만든 화면 값이다.
import type { ApprovalCardRequest } from "../approval-card/model.ts";

/** agent tool call의 ask: session 허락을 고를 수 있다. */
export const TOOL_ASK_REQUEST: ApprovalCardRequest = {
  id: "apr_01h455vb4pex5v6nkc6gd5f001",
  title: "Rewrite docs/reports/2026-w40.md?",
  reason:
    "lophn wants to replace last week's report with the corrected numbers.",
  preview: [
    { kind: "remove", text: "Scenarios passed: 41 of 44" },
    { kind: "add", text: "Scenarios passed: 40 of 44" },
    { kind: "add", text: "Regressions: query-recipe-gap, sched-edit" },
  ],
  allowSession: true,
};

/** 앱 command의 confirm: 정확한 대상 하나를 보고 결정하므로 session 선택이 없다. */
export const COMMAND_CONFIRM_REQUEST: ApprovalCardRequest = {
  id: "apr_01h455vb4pex5v6nkc6gd5f002",
  title: "Delete 3 entries in Expenses?",
  reason: "The Expenses app asks to delete entries older than a year.",
  preview: null,
  allowSession: false,
};
