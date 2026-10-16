import {
  agentNameKey,
  BUILTIN_ROLE_NAMES,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";

// 제품이 이름을 고정하는 built-in(lophn, Project Manager, App Engineer). Operator는 이 이름을 쓰지 못한다.
export const BUILTIN_NAMES: Record<Exclude<Role, "operator">, string> = {
  lophn: BUILTIN_ROLE_NAMES.lophn,
  project_manager: BUILTIN_ROLE_NAMES.project_manager,
  app_engineer: BUILTIN_ROLE_NAMES.app_engineer,
};

export function isReservedAgentName(name: string): boolean {
  const key = agentNameKey(name);
  return Object.values(BUILTIN_NAMES).some((builtin) =>
    agentNameKey(builtin) === key
  );
}
