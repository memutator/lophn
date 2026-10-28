import {
  err,
  fingerprint,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  type AgentDefinition,
  type AgentDefinitionIssue,
  type AgentId,
  type AgentValueLayer,
  LOPHN_AGENT_ID,
  LOPHN_AGENT_NAME,
  type McpTool,
  type ModelChoice,
  type Place,
  type Profile,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import { skillReceived } from "../extensions/skills.ts";
import type { AgentFileDefinition } from "./definition-file.ts";

export const LOPHN_PROFILE: Profile = {
  kind: "character",
  shape: "square",
  color: "coral",
};

export const AGENT_DEFAULT_PROFILE: Profile = {
  kind: "character",
  shape: "arch",
  color: "sage",
};

// 환경이 준 skill 한 개다. 끌 수 없는 내장 skill인지와 domain 층 skill의 domain을 같이 알린다(아니면 null).
export type AvailableSkill = {
  name: string;
  can_disable: boolean;
  domain: string | null;
};

type ResolveEnvironment = {
  skills: readonly AvailableSkill[];
  mcp: readonly McpTool[];
  domains: readonly string[];
};

type ResolveInput = {
  agent: AgentId;
  role: Role;
  place: Place | null;
  definition: AgentFileDefinition | null;
  global_model: ModelChoice | null;
  project_model?: ModelChoice | null;
  session_model: ModelChoice | null;
  tools: readonly string[];
  environment: ResolveEnvironment;
};

const RESOLVED_FIELDS = [
  "name",
  "profile",
  "agent_instructions",
  "model",
  "tools",
  "skills",
  "mcp",
  "domains",
] as const;
type ResolvedField = (typeof RESOLVED_FIELDS)[number];

export type ResolvedAgent = {
  agent: AgentId;
  role: Role;
  place: Place | null;
  name: string;
  profile: Profile;
  agent_instructions: string;
  model: ModelChoice;
  tools: string[];
  skills: string[];
  mcp: McpTool[];
  domains: string[];
  sources: Record<ResolvedField, AgentValueLayer>;
  hash: string;
};

// 값마다 마지막 층이 이긴다(전역 → project → agent → session).
// - model은 ModelChoice 하나를 통째로 쓴다. 어느 층에도 없으면 turn을 시작하지 않는다.
// - tools는 place 종류가 고정한 목록이다. 정의에 무엇을 적어도 바뀌지 않는다.
// - domains는 정의가 고른 domain과 환경이 준 그릇의 domain의 교집합이다.
// - skills는 환경이 준 것 가운데 전역·내장 skill과 맡은 domain의 skill이고, 정의가 고른 이름만 남긴다.
// - agent_instructions는 정의 본문의 sha256Hex(정의가 없으면 빈 글), hash는 hash를 뺀 값의 fingerprint다.
export async function resolveAgent(
  input: ResolveInput,
): Promise<Result<ResolvedAgent, LophnError>> {
  const { agent, role, place, definition, environment } = input;
  if (agent !== LOPHN_AGENT_ID && definition === null) {
    return err({ code: "not_found", message: "agent definition not found" });
  }

  const modelLayers: [ModelChoice | null | undefined, AgentValueLayer][] = [
    [input.session_model, "session"],
    [definition?.model, "agent"],
    [input.project_model, "project"],
    [input.global_model, "global"],
  ];
  const chosen = modelLayers.find(([choice]) => choice != null);
  if (chosen === undefined) {
    return invalid([{ field: "model", code: "required" }]);
  }

  const body = definition?.body ?? "";
  const lophn = agent === LOPHN_AGENT_ID;
  const profile = lophn
    ? LOPHN_PROFILE
    : (definition?.profile ?? AGENT_DEFAULT_PROFILE);
  const chosenSkills = definition?.skills ?? [];
  const mcpOff = definition?.mcp_off ?? [];
  const chosenDomains = definition?.domains ?? [];
  const domains = workingDomains(environment.domains, chosenDomains);
  const skills = receivedSkills(environment.skills, chosenSkills, domains);
  const mcp = environment.mcp.filter(
    (tool) =>
      !mcpOff.some(
        (off) =>
          off.server_name === tool.server_name &&
          (off.original_tool === undefined ||
            off.original_tool === tool.original_tool),
      ),
  );

  const value: Omit<ResolvedAgent, "hash"> = {
    agent: copy(agent),
    role,
    place: copy(place),
    name: lophn ? LOPHN_AGENT_NAME : (definition as AgentDefinition).name,
    profile: copy(profile),
    agent_instructions: await sha256Hex(body),
    model: copy(chosen[0] as ModelChoice),
    tools: [...input.tools],
    skills,
    mcp: copy(mcp),
    domains,
    sources: {
      name: lophn ? "global" : "agent",
      profile: lophn || definition?.profile === undefined ? "global" : "agent",
      agent_instructions: body.length > 0 ? "agent" : "global",
      model: chosen[1],
      tools: "global",
      skills: chosenSkills.length > 0 ? "agent" : "global",
      mcp: mcpOff.length > 0 ? "agent" : "global",
      domains: chosenDomains.length > 0 ? "agent" : "global",
    },
  };
  return ok({ ...value, hash: await fingerprint(value) });
}

export function workingDomains(
  container: readonly string[],
  chosen: readonly string[],
): string[] {
  return chosen.length === 0
    ? [...container]
    : container.filter((id) => chosen.includes(id));
}

export function receivedSkills(
  available: readonly AvailableSkill[],
  chosen: readonly string[],
  domains: readonly string[],
): string[] {
  return [
    ...new Set(
      available
        .filter((skill) => skillReceived(skill, chosen, domains))
        .map((skill) => skill.name),
    ),
  ];
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function invalid(issues: AgentDefinitionIssue[]): Result<never, LophnError> {
  return err({
    code: "invalid_input",
    message: "agent cannot be resolved",
    details: { issues },
  });
}
