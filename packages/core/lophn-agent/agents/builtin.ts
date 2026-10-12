import {
  type AgentRole,
  BUILTIN_AGENT_NAMES,
  type McpTool,
  type Profile,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ResolveEnvironment } from "./resolve.ts";
import { ROLE_CAPS } from "./role-caps.ts";

// built-in agent의 정의는 코드에 있다: 제품 이름, 기본 icon, 역할 상한(role-caps.ts). 정의 파일은 사람이 바꾼
// 칸만 가지므로 파일이 없어도 built-in은 완전한 agent다(lophn-agent/agents R5, R13, R20).

export type BuiltinRole = Exclude<AgentRole, "operator">;

export const BUILTIN_AGENTS: Record<
  BuiltinRole,
  { name: string; profile: Profile }
> = {
  lophn: {
    name: BUILTIN_AGENT_NAMES.lophn,
    profile: { kind: "icon", icon: "dock" },
  },
  context_engineer: {
    name: BUILTIN_AGENT_NAMES.context_engineer,
    profile: { kind: "icon", icon: "contexts" },
  },
  app_engineer: {
    name: BUILTIN_AGENT_NAMES.app_engineer,
    profile: { kind: "icon", icon: "apps" },
  },
};

// 역할별 기본 icon. Operator는 이름을 정의 파일에서 받지만 icon은 제품 기본이 있다(R13).
export const DEFAULT_PROFILES: Record<AgentRole, Profile> = {
  lophn: BUILTIN_AGENTS.lophn.profile,
  context_engineer: BUILTIN_AGENTS.context_engineer.profile,
  app_engineer: BUILTIN_AGENTS.app_engineer.profile,
  operator: { kind: "icon", icon: "roles" },
};

export function roleCapsOf(role: AgentRole): readonly string[] {
  return ROLE_CAPS.get(role)?.tools ?? [];
}

// 자리에서 모은 등록 skill·MCP·active context를 제품 고정값(역할 상한, 기본 icon)과 묶어 resolve 입력의 환경으로 만든다.
export function productEnvironment(
  role: AgentRole,
  registered: {
    skills: readonly string[];
    mcp: readonly McpTool[];
    active_contexts: readonly string[];
  },
): ResolveEnvironment {
  return {
    role_caps: roleCapsOf(role),
    default_profile: DEFAULT_PROFILES[role],
    skills: registered.skills,
    mcp: registered.mcp,
    active_contexts: registered.active_contexts,
  };
}
