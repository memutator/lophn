import { type AgentId, type Place } from "../../../protocol/lophn-agent/mod.ts";

// session의 agent 정의 file 경로다. 모든 agent가 `<data>/agents/<id>.md`에 있다.
export function agentFilePathOf(
  root: string,
  session: { agent: AgentId; place: Place | null },
): string {
  return `${root}/agents/${session.agent}.md`;
}
