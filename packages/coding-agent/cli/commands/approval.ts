// approval command의 route 표와 `approval open` 실행이다. list·show는
// 소유 읽기 route로 core에 닿는다. open은 결정 화면 링크와 대기 사실만 낸다: confirmation
// window를 열지 않고 TTY의 yes나 옵션으로 허락하지 않는다. 허락·거절·사용 command는
// 표에 없다(승인은 사람 confirmation window에서만 한다).
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  cliApprovalListSchema,
  cliApprovalOpenSchema,
  cliApprovalShowSchema,
} from "../../../protocol/coding-agent/mod.ts";
import {
  approvalsGet,
  approvalsList,
} from "../../../protocol/approvals/mod.ts";
import {
  type ApprovalRequest,
  approvalStateText,
  approvalView,
  type FlowClient,
} from "../../connection/mod.ts";
import type { CommandEntry } from "./types.ts";

export const APPROVAL_COMMANDS: readonly CommandEntry[] = [
  {
    name: "approval list",
    input: cliApprovalListSchema,
    monoRoute: approvalsList,
  },
  {
    name: "approval show",
    input: cliApprovalShowSchema,
    monoRoute: approvalsGet,
  },
  // open은 결정 화면 링크와 대기 사실만 낸다. 허락을 입력받지 않는다.
  {
    name: "approval open",
    input: cliApprovalOpenSchema,
  },
];

export type ApprovalOpenDeps = { client: Pick<FlowClient, "read"> };

export type ApprovalOpenReport = {
  summary: string;
  data: {
    approval: string;
    state: string;
    waiting: boolean;
    decision_link: string | null;
    // open은 창을 열지 않고 허락을 받지 않는다. 항상 false다.
    window_opened: false;
  };
  next: string[];
};

// approval request를 한 번 읽어 대기 사실과 결정 화면 링크를 낸다. 대기가 아니면 열
// 결정이 없다. 읽기 실패(남의 요청·없는 요청)는 core 오류 그대로다. 요청은 이 호출로
// 허락·거절·사용되지 않는다.
export async function runApprovalOpen(
  input: { approval: string },
  deps: ApprovalOpenDeps,
): Promise<Result<ApprovalOpenReport, LophnError>> {
  const read = await deps.client.read(approvalsGet, {
    approval: input.approval,
  });
  if (!read.ok) return err(read.error);
  const value = read.value as { request: ApprovalRequest; use: unknown };
  const shown = approvalView(value.request, value.use);
  return ok({
    summary: `approval ${shown.id}: ${approvalStateText(shown.state)}`,
    data: {
      approval: shown.id,
      state: shown.state,
      waiting: shown.waiting,
      decision_link: shown.decision_link,
      window_opened: false,
    },
    next: shown.waiting
      ? [
        `사람이 ${shown.decision_link}에서 결정한다. 창을 닫거나 기한이 지나면 요청은 그대로다`,
      ]
      : [`approval show ${shown.id}로 결과를 읽는다`],
  });
}
