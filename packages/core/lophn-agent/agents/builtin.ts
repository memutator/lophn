import type { Profile, Role } from "../../../protocol/lophn-agent/mod.ts";

// built-in agent의 이름(names.ts)과 기본 icon은 제품이 정한다. 정의 파일은 사람이 바꾼 칸만 가지므로
// 파일이 없어도 built-in은 완전한 agent다. Operator는 이름을 정의 파일에서 받지만 icon은 제품 기본이 있다.
export const DEFAULT_PROFILES: Record<Role, Profile> = {
  lophn: { kind: "icon", icon: "dock" },
  project_manager: { kind: "icon", icon: "contexts" },
  app_engineer: { kind: "icon", icon: "apps" },
  operator: { kind: "icon", icon: "roles" },
};
