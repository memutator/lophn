import type { Result } from "../../../base/mod.ts";
import type {
  Assignment,
  AssignmentEntry,
} from "../../../protocol/approvals/mod.ts";
import { definePort } from "../../../protocol/base/mod.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";

// 할당은 agent 정의 파일(`apps`, `permissions.deny`)에 있다. approvals는 정의 파일도 앱 표도 모르므로
// 읽고 쓰는 길은 조립(core/main)이 tx와 snapshot마다 꽂는다.
// revision은 할당 내용에서 정한 비교 값이다(정의 파일의 다른 칸을 고쳐도 바뀌지 않는다). 할당이 없으면 0이다.
export type AssignmentState = { assignment: Assignment; revision: number };

export interface AssignmentPorts {
  get(agent: AgentId): Result<AssignmentState>;
  // 비교 값이 지금과 다르면 conflict다.
  set(
    agent: AgentId,
    entries: readonly AssignmentEntry[],
    revision: number,
  ): Result<AssignmentState>;
}

export const assignmentPorts = definePort<AssignmentPorts>(
  "approvals.assignment",
);
