import { type AgentId, type Place } from "../../../protocol/lophn-agent/mod.ts";

// session의 agent 정의 file 경로다. 모든 agent가 `<data>/agents/<id>.md`에 있다.
export function agentFilePathOf(
  root: string,
  session: { agent: AgentId; place: Place | null },
): string {
  return `${root}/agents/${session.agent}.md`;
}

// 어느 place 종류든 자기 place 그릇의 domain만 읽는다. home은 place가 없어 읽을 domain이 없다.
export function mayReadDomain(
  place: Place | null,
  owner: { kind: string; id: string },
): boolean {
  return place !== null && place.kind === owner.kind && place.id === owner.id;
}
