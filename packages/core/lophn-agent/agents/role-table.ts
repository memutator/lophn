import type { Profile, Role } from "../../../protocol/lophn-agent/mod.ts";

// role마다 다른 값과 규칙이다. harness는 role 이름을 모르므로 role 층(agent-roles)이 표를 내놓고 조립이
// 넘긴다.
export type AgentRoleTable = {
  isOperator(role: Role): boolean;
  // 제품이 이름을 고정한 built-in의 이름이다. Operator는 이름을 정의 파일에서 받으므로 null이다.
  builtinName(role: Role): string | null;
  // 정의에 profile이 없을 때의 기본 profile.
  defaultProfile(role: Role): Profile;
  // 이 role이 읽을 context다. chosen은 정의가 고른 것, active는 place의 active context다.
  // picked는 정의가 context를 골랐는지(sources의 출처)다.
  contextsOf(
    role: Role,
    input: { chosen: readonly string[]; active: readonly string[] },
  ): { contexts: string[]; picked: boolean };
};
