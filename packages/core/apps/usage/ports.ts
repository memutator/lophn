import { definePort } from "../../../protocol/base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentRef, Role } from "../../../protocol/lophn-agent/places.ts";

// 사용 관계가 agent와 session이 놓인 project를 알아내는 길. sessions 표와 agent 정의는 apps의 것이 아니므로
// 구현은 조립(core/main)이 tx와 snapshot마다 꽂는다.
export interface UsagePorts {
  // session의 role과 놓인 project. lophn session은 project가 null이다. session이 없으면 null이다.
  sessionPlace(
    session: string,
  ): { role: Role; project: Id<"prj"> | null } | null;
  // PM은 자기 project, Operator는 정의의 place, lophn은 null이다.
  agentProject(agent: AgentRef): Id<"prj"> | null;
}

export const usagePorts = definePort<UsagePorts>("apps.usage");
