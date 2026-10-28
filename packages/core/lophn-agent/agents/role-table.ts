import type {
  AgentDefinitionRow,
  AgentRef,
  Place,
  Profile,
  Role,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AgentSlot } from "./store.ts";

// role마다 다른 값과 규칙이다. harness는 role 이름을 모르므로 role 층(agent-places)이 표를 내놓고 조립이
// 넘긴다.
export type AgentRoleTable = {
  isOperator(role: Role): boolean;
  // 제품이 이름을 고정한 built-in의 이름이다. Operator는 이름을 정의 파일에서 받으므로 null이다.
  builtinName(role: Role): string | null;
  // 정의에 profile이 없을 때의 기본 profile.
  defaultProfile(role: Role): Profile;
  // 정의 파일 자리. Operator의 place는 ref에 없어 호출하는 쪽이 정해 주고, 없으면 null이다.
  slotOf(root: string, ref: AgentRef, operatorPlace?: Place): AgentSlot | null;
  // place의 agents 폴더(Operator 정의와 profile 이미지가 놓인다).
  agentsFolderOf(root: string, place: Place): string;
  // 목록에 보일 built-in 순서: lophn, 그 다음 place마다 하나.
  builtinRefs(places: readonly Place[]): AgentRef[];
  operatorRef(id: string): AgentRef;
  kindOf(role: Role): AgentDefinitionRow["kind"];
  // Operator가 쓰지 못하는 이름(built-in 이름)인가.
  isReservedName(name: string): boolean;
};
