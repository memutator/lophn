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
  type AgentRuntime,
  type AgentValueLayer,
  isLophn,
  LOPHN_AGENT_NAME,
  MCP_TOOL_PREFIX,
  type McpTool,
  type ModelChoice,
  type Workspace,
  type Profile,
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

// 환경이 준 skill 한 개다. 끌 수 없는 내장 skill인지를 같이 알린다.
export type AvailableSkill = {
  name: string;
  can_disable: boolean;
};

type ResolveEnvironment = {
  skills: readonly AvailableSkill[];
  mcp: readonly McpTool[];
};

type ResolveInput = {
  agent: AgentId;
  workspace: Workspace | null;
  // 다른 workspace의 session이 불러 열린 session이면 그 workspace.
  called_from: Workspace | null;
  definition: AgentFileDefinition | null;
  global_model: ModelChoice | null;
  workspace_model?: ModelChoice | null;
  session_model: ModelChoice | null;
  tools: readonly string[];
  environment: ResolveEnvironment;
};

const RESOLVED_FIELDS = [
  "name",
  "profile",
  "agent_instructions",
  "model",
  "runtime",
  "picks",
  "tools",
  "skills",
  "mcp",
] as const;
type ResolvedField = (typeof RESOLVED_FIELDS)[number];

export type ResolvedAgent = {
  agent: AgentId;
  workspace: Workspace | null;
  called_from: Workspace | null;
  name: string;
  profile: Profile;
  agent_instructions: string;
  model: ModelChoice;
  runtime: AgentRuntime;
  // 정의 `tools`에 적힌 이름이다(고른 skill이 있으면 `skill.read`가 더해진다). custom이 아니면 빈 목록이다. workspace 종류 목록과 할당·MCP 안으로 줄이는 것은 조립의 일이다.
  picks: string[];
  tools: string[];
  skills: string[];
  mcp: McpTool[];
  sources: Record<ResolvedField, AgentValueLayer>;
  hash: string;
};

// 값마다 마지막 층이 이긴다(전역 → project → agent → session).
// - model은 ModelChoice 하나를 통째로 쓴다. 어느 층에도 없으면 turn을 시작하지 않는다.
// - tools는 workspace 종류가 고정한 목록이다. 정의에 무엇을 적어도 바뀌지 않는다. custom이 고른 이름은 picks에 따로 있다.
// - skills는 환경이 준 것 가운데 정의가 끈 이름(skills_off)을 뺀 것이다. custom은 정의 `skills`가 고른 이름만이고
//   harness는 skill을 받지 않아 빈 목록이다(harness는 자기 skill 폴더를 쓴다).
// - agent_instructions는 정의 본문의 sha256Hex(정의가 없으면 빈 글), hash는 hash를 뺀 값의 fingerprint다.
export async function resolveAgent(
  input: ResolveInput,
): Promise<Result<ResolvedAgent, LophnError>> {
  const { agent, workspace, definition, environment } = input;
  if (!isLophn(agent) && definition === null) {
    return err({ code: "not_found", message: "agent definition not found" });
  }

  const modelLayers: [ModelChoice | null | undefined, AgentValueLayer][] = [
    [input.session_model, "session"],
    [definition?.model, "agent"],
    [input.workspace_model, "project"],
    [input.global_model, "global"],
  ];
  const chosen = modelLayers.find(([choice]) => choice != null);
  if (chosen === undefined) {
    return invalid([{ field: "model", code: "required" }]);
  }

  const body = definition?.body ?? "";
  const lophn = isLophn(agent);
  const profile = lophn
    ? LOPHN_PROFILE
    : (definition?.profile ?? AGENT_DEFAULT_PROFILE);
  const skillsOff = definition?.skills_off ?? [];
  const mcpOff = definition?.mcp_off ?? [];
  const runtime: AgentRuntime = definition?.runtime ?? "lophn";
  const skillPicks = runtime === "custom" ? (definition?.skills ?? []) : [];
  // custom이 고른 skill은 있는 것만 받는다. 목록을 읽을 길(`skill.read`)이 없으면 목록이 소용없어 함께 고른 것으로 친다.
  const skills =
    runtime === "custom"
      ? receivedSkills(environment.skills, []).filter((name) =>
          skillPicks.includes(name),
        )
      : runtime === "lophn"
        ? receivedSkills(environment.skills, skillsOff)
        : [];
  const toolPicks = runtime === "custom" ? (definition?.tools ?? []) : [];
  const picks =
    runtime === "custom" &&
    skills.length > 0 &&
    !toolPicks.includes("skill.read")
      ? [...toolPicks, "skill.read"]
      : toolPicks;
  // custom은 `mcp__<server>__<tool>`로 고른 tool만 받고 harness는 받지 않는다. 고르지 않은 서버는 연결 목록에도 서지 않는다.
  const mcp = environment.mcp
    .filter(
      (tool) =>
        runtime === "lophn" ||
        (runtime === "custom" &&
          picks.includes(
            `${MCP_TOOL_PREFIX}${tool.server_name}__${tool.original_tool}`,
          )),
    )
    .filter(
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
    workspace: copy(workspace),
    called_from: copy(input.called_from),
    name: definition?.name ?? LOPHN_AGENT_NAME,
    profile: copy(profile),
    agent_instructions: await sha256Hex(body),
    model: copy(chosen[0] as ModelChoice),
    runtime,
    picks: [...picks],
    tools: [...input.tools],
    skills,
    mcp: copy(mcp),
    sources: {
      name:
        lophn && (definition?.name ?? LOPHN_AGENT_NAME) === LOPHN_AGENT_NAME
          ? "global"
          : "agent",
      profile: lophn || definition?.profile === undefined ? "global" : "agent",
      agent_instructions: body.length > 0 ? "agent" : "global",
      model: chosen[1],
      runtime: definition?.runtime === undefined ? "global" : "agent",
      picks: picks.length > 0 ? "agent" : "global",
      tools: "global",
      skills:
        skillsOff.length > 0 || skillPicks.length > 0 ? "agent" : "global",
      mcp: mcpOff.length > 0 ? "agent" : "global",
    },
  };
  return ok({ ...value, hash: await fingerprint(value) });
}

export function receivedSkills(
  available: readonly AvailableSkill[],
  off: readonly string[],
): string[] {
  return [
    ...new Set(
      available
        .filter((skill) => skillReceived(skill, off))
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
