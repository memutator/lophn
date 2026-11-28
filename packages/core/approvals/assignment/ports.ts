import type { Result } from "../../../base/mod.ts";
import type {
  Assignment,
  AssignmentEntry,
} from "../../../protocol/approvals/mod.ts";
import { definePort } from "../../../protocol/base/mod.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";

// 다른 컴퓨터 앱 할당은 agent 정의 파일(`remote_apps`)에 있다. approvals는 정의 파일도 앱 표도 모르므로
// 읽고 쓰는 길은 조립(core/main)이 tx와 snapshot마다 꽂는다.
// revision은 할당 내용에서 정한 비교 값이다(정의 파일의 다른 칸을 고쳐도 바뀌지 않는다). 할당이 없으면 0이다.
export type AssignmentState = { assignment: Assignment; revision: number };

// 공유 요청의 승인이 이 컴퓨터의 앱을 agent에게 더하는 줄이다. 앱 할당이 skill 배포로 바뀌기 전의 모양이 공유 요청에 남아 있어 받아 준다:
// 조립이 그 앱의 public skill을 agent 층에 배포하는 것으로 읽는다. 공유 요청을 지우는 일에서 함께 없어진다.
export type LocalAppLine = {
  app: string;
  removed_tools: readonly string[];
};

export interface AssignmentPorts {
  get(agent: AgentId): Result<AssignmentState>;
  // 비교 값이 지금과 다르면 conflict다.
  set(
    agent: AgentId,
    entries: readonly (AssignmentEntry | LocalAppLine)[],
    revision: number,
  ): Result<AssignmentState>;
}

export const assignmentPorts = definePort<AssignmentPorts>(
  "approvals.assignment",
);
