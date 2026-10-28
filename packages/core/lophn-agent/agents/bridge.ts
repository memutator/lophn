import {
  type AgentId,
  type AgentRef,
  LOPHN_AGENT_ID,
} from "../../../protocol/lophn-agent/mod.ts";

// session과 turn이 아직 `AgentRef`를 쓸 동안 정의를 찾는 id로 바꾸는 다리다. 정의가 전역이 되면서
// place가 ref에 없는 에이전트는 정의를 고를 수 없어 null이다.
export function agentIdOfRef(ref: AgentRef): AgentId | null {
  if (ref.role === "lophn") return LOPHN_AGENT_ID;
  return "agent" in ref ? ref.agent : null;
}
