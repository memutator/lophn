import {
  agentRefOfColumns,
  type Place,
  type Role,
  rolePlaceFits,
} from "../../../protocol/lophn-agent/mod.ts";
import { ROLE_TABLE } from "../agents/role-table.ts";

// 지침 읽기 권한: 다른 project의 지침은 lophn만 읽는다. 나머지 role은 자기 place의 project만 받는다.
export function mayReadOtherProject(role: Role): boolean {
  return role === "lophn";
}

// session의 agent 정의 file 경로. 자리는 role 표의 slotOf가 정한다. place가 그 role과 맞지 않거나 Operator의
// 정의 id가 없으면 null이다.
export function agentFilePathOf(
  root: string,
  session: { role: Role; operator: string | null; place: Place | null },
): string | null {
  const { role, operator, place } = session;
  const project = place?.kind === "project" ? place.id : null;
  const app = place?.kind === "app" ? place.id : null;
  if (!rolePlaceFits(role, place)) return null;
  if (ROLE_TABLE.isOperator(role) && operator === null) return null;
  const slot = ROLE_TABLE.slotOf(
    root,
    agentRefOfColumns({ role, project, app, operator }),
    place ?? undefined,
  );
  return slot === null ? null : `${slot.folder}/${slot.file}`;
}

// 어느 role이든 자기 place 그릇의 domain만 읽는다. lophn은 place가 없어 읽을 domain이 없다.
export function mayReadDomain(
  place: Place | null,
  owner: { kind: string; id: string },
): boolean {
  return place !== null && place.kind === owner.kind && place.id === owner.id;
}
