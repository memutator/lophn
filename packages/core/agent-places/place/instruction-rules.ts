import { type Place, type Role } from "../../../protocol/lophn-agent/mod.ts";

// 지침 읽기 권한: 다른 project의 지침은 lophn만 읽는다. 나머지 role은 자기 place의 project만 받는다.
export function mayReadOtherProject(role: Role): boolean {
  return role === "lophn";
}

// session의 agent 정의 file 경로다. 모든 agent가 `<data>/agents/<id>.md`에 있고, lophn만 place 없이 있다.
export function agentFilePathOf(
  root: string,
  session: { role: Role; operator: string | null; place: Place | null },
): string | null {
  const { role, operator, place } = session;
  if (role === "lophn" && place === null) return `${root}/agents/lophn.md`;
  return operator === null ? null : `${root}/agents/${operator}.md`;
}

// 어느 role이든 자기 place 그릇의 domain만 읽는다. lophn은 place가 없어 읽을 domain이 없다.
export function mayReadDomain(
  place: Place | null,
  owner: { kind: string; id: string },
): boolean {
  return place !== null && place.kind === owner.kind && place.id === owner.id;
}
