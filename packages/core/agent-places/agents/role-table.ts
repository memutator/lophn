import {
  agentNameKey,
  BUILTIN_ROLE_NAMES,
  type Profile,
  ROLES,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AgentRoleTable } from "../../lophn-agent/agents/role-table.ts";
import { lophnAgentsFolder, placeAgentsFolder } from "../place/data-folder.ts";

// built-in agent의 이름은 제품이 정한다. 정의 파일은 사람이 바꾼 칸만 가지므로 파일이 없어도 built-in은
// 완전한 agent다. Operator는 이름을 정의 파일에서 받지만 profile은 제품 기본이 있다.
const PROFILES: Record<Role, Profile> = {
  lophn: { kind: "character", shape: "square", color: "coral" },
  project_manager: { kind: "character", shape: "capsule", color: "periwinkle" },
  app_engineer: { kind: "character", shape: "wide", color: "yellow" },
  operator: { kind: "character", shape: "arch", color: "sage" },
};

// 이 파일 이름이 바뀌면 사람이 만든 built-in 정의를 못 찾는다.
const BUILTIN_FILES = {
  lophn: "lophn.md",
  project_manager: "project-manager.md",
  app_engineer: "app-engineer.md",
} as const;

export const ROLE_TABLE: AgentRoleTable = {
  isOperator: (role) => role === "operator",
  builtinName: (role) =>
    role === "operator" ? null : BUILTIN_ROLE_NAMES[role],
  defaultProfile: (role) => PROFILES[role],
  slotOf(root, ref, operatorPlace) {
    switch (ref.role) {
      case "lophn":
        return { folder: lophnAgentsFolder(root), file: BUILTIN_FILES.lophn };
      case "project_manager":
        return {
          folder: placeAgentsFolder(root, { kind: "project", id: ref.project }),
          file: BUILTIN_FILES.project_manager,
        };
      case "app_engineer":
        return {
          folder: placeAgentsFolder(root, { kind: "app", id: ref.app }),
          file: BUILTIN_FILES.app_engineer,
        };
      case "operator":
        return operatorPlace === undefined
          ? null
          : {
              folder: placeAgentsFolder(root, operatorPlace),
              file: `${ref.agent}.md`,
            };
    }
  },
  agentsFolderOf: placeAgentsFolder,
  builtinRefs: (places) => [
    { role: "lophn" },
    ...places.map((place) =>
      place.kind === "project"
        ? { role: "project_manager" as const, project: place.id }
        : { role: "app_engineer" as const, app: place.id },
    ),
  ],
  operatorRef: (id) => ({ role: "operator", agent: id as never }),
  kindOf: (role) => (role === "operator" ? "operator" : "built_in"),
  isReservedName(name) {
    const key = agentNameKey(name);
    return ROLES.some(
      (role) =>
        role !== "operator" && agentNameKey(BUILTIN_ROLE_NAMES[role]) === key,
    );
  },
};
