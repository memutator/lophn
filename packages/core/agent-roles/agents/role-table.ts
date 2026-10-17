import {
  BUILTIN_ROLE_NAMES,
  type Profile,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AgentRoleTable } from "../../lophn-agent/agents/role-table.ts";

// built-in agent의 이름은 제품이 정한다. 정의 파일은 사람이 바꾼 칸만 가지므로 파일이 없어도 built-in은
// 완전한 agent다. Operator는 이름을 정의 파일에서 받지만 icon은 제품 기본이 있다.
const PROFILES: Record<Role, Profile> = {
  lophn: { kind: "icon", icon: "dock" },
  project_manager: { kind: "icon", icon: "contexts" },
  app_engineer: { kind: "icon", icon: "apps" },
  operator: { kind: "icon", icon: "roles" },
};

export const ROLE_TABLE: AgentRoleTable = {
  isOperator: (role) => role === "operator",
  builtinName: (role) => role === "operator" ? null : BUILTIN_ROLE_NAMES[role],
  defaultProfile: (role) => PROFILES[role],
  contextsOf(role, { chosen, active }) {
    // Operator는 정의가 고른 것 가운데 active인 것(정의 순서), Project Manager는 active 전부(주어진 순서),
    // 나머지는 context 자료가 없다.
    if (role === "operator") {
      const live = new Set(active);
      return {
        contexts: chosen.filter((id) => live.has(id)),
        picked: chosen.length > 0,
      };
    }
    return {
      contexts: role === "project_manager" ? [...active] : [],
      picked: false,
    };
  },
};
