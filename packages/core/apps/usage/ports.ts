import { definePort } from "../../../protocol/base/mod.ts";
import type { AgentRef, Role } from "../../../protocol/lophn-agent/places.ts";

// 사용 관계가 agent와 session이 맡은 domain을 알아내는 길. sessions 표와 agent 정의는 apps의 것이 아니므로
// 구현은 조립(core/main)이 tx와 snapshot마다 꽂는다.
export interface UsagePorts {
  // session의 role과 그 agent가 맡은 domain id. lophn은 []다. session이 없으면 null이다.
  sessionDomains(
    session: string,
  ): { role: Role; domains: string[] } | null;
  // PM·App Engineer는 그 그릇의 active domain 전부, Operator는 정의의 domains와 그릇의 교집합(고른 것이 없을 때만 전부), lophn은 []다.
  agentDomains(agent: AgentRef): string[];
  // 그 앱의 domain 이름 → id. 없으면 null이다.
  domainOf(app: string, name: string): string | null;
}

export const usagePorts = definePort<UsagePorts>("apps.usage");
