import {
  err,
  fingerprint,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  type AgentDefinitionIssue,
  type AgentRef,
  type AgentValueLayer,
  type McpTool,
  type ModelChoice,
  type Place,
  type Profile,
  type Role,
  rolePlaceFits,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AgentFileDefinition } from "./definition-file.ts";
import type { AgentRoleTable } from "./role-table.ts";

// 설정 층을 합쳐 turn마다 고정하는 resolved agent를 만든다. 읽은 값만 받는 순수 함수라 파일도 시각도
// 만지지 않는다: 정의 파일은 호출하는 쪽이 읽어 파싱해 넘기고, 같은 입력이면 같은 값과 hash가 나온다.

// 제품이 고정하거나 다른 concern이 정하는 값이다. 테스트가 작은 값으로 바꿔 끼운다.
type ResolveEnvironment = {
  // 정의에 profile이 없을 때의 기본 icon.
  default_profile: Profile;
  // 이 place에서 쓸 수 있는 skill 이름과 MCP tool. 전역 층과 project 층을 이름 단위로 합친 것이다(등록 순서).
  skills: readonly string[];
  mcp: readonly McpTool[];
  // place의 active context다. project place는 그 project의 것이다.
  // 보관한 context는 들어 있지 않다.
  active_contexts: readonly string[];
};

type ResolveInput = {
  agent: AgentRef;
  // Project Manager와 App Engineer와 Operator의 place. lophn은 null이다.
  place: Place | null;
  // 정의 파일이 없으면 null(built-in 기본). Operator는 파일이 있어야 agent다.
  definition: AgentFileDefinition | null;
  // 전역 기본 model, project 층 model, composer에서 이 session만 고른 model. 없으면 null이다.
  global_model: ModelChoice | null;
  project_model?: ModelChoice | null;
  session_model: ModelChoice | null;
  // role이 고정한 tool 이름 목록. 어느 tool이 있는지는 role 층이 정한다.
  tools: readonly string[];
  // role마다 다른 이름·context 규칙. role 층이 정한다.
  roles: AgentRoleTable;
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
  "contexts",
] as const;
type ResolvedField = (typeof RESOLVED_FIELDS)[number];

export type ResolvedAgent = {
  agent: AgentRef;
  role: Role;
  place: Place | null;
  name: string;
  profile: Profile;
  // 정의 본문의 sha256이다. 본문은 지침 읽기가 따로 한다.
  agent_instructions: string;
  model: ModelChoice;
  tools: string[];
  skills: string[];
  mcp: McpTool[];
  contexts: string[];
  sources: Record<ResolvedField, AgentValueLayer>;
  hash: string;
};

// 값마다 마지막 층이 이긴다(전역 → project → agent → session). 규칙:
// - model은 ModelChoice 하나를 통째로 쓴다(option을 층끼리 섞지 않는다). 어느 층에도 없으면
//   invalid_input(`model` required)이고 turn을 시작하지 않는다. role별 기본은 없다.
// - tools는 role이 고정한 목록이다. 정의에 무엇을 적어도 바뀌지 않는다. 앱·MCP·다른 agent는 agent grant가
//   session을 시작할 때 붙인다.
// - skills·mcp는 환경이 준 것(전역과 project 층을 합친 것) 가운데 skills_off·mcp_off에 없는 것(등록 순서)이다.
//   등록에 없는 끈 기록은 무시한다.
// - contexts는 Operator면 정의가 고른 것 가운데 active인 것(정의 순서), Project Manager와 App Engineer는
//   active 전부(주어진 순서), lophn은 없다.
// - agent_instructions는 정의 본문의 sha256Hex(정의가 없으면 빈 글), hash는 hash를 뺀 값의 fingerprint다.
// - sources: 값마다 그 값을 준 층. 정의는 칸을 실제로 가질 때만(profile·model·본문·비어 있지 않은 목록)
//   `agent`이고 아니면 `global`이다.
// 오류: Operator인데 정의가 없으면 not_found, role이 그 place에 올 수 없으면 invalid_input(`place`
// not_allowed), Operator 정의에 name이 없으면 invalid_input(`name` required).
export async function resolveAgent(
  input: ResolveInput,
): Promise<Result<ResolvedAgent, LophnError>> {
  const { agent, place, definition, environment } = input;
  const { roles } = input;
  const role = agent.role;
  const operator = roles.isOperator(role);

  if (!rolePlaceFits(role, place)) {
    return invalid([{ field: "place", code: "not_allowed" }]);
  }
  if (operator && definition === null) {
    return err({ code: "not_found", message: "operator definition not found" });
  }
  const given = operator && definition !== null && "name" in definition
    ? definition.name
    : undefined;
  if (operator && (given === undefined || given.trim().length === 0)) {
    return invalid([{ field: "name", code: "required" }]);
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
  const profile = definition !== null && "profile" in definition
    ? definition.profile
    : undefined;
  const skillsOff = definition?.skills_off ?? [];
  const mcpOff = definition?.mcp_off ?? [];
  const skills = environment.skills.filter((name) => !skillsOff.includes(name));
  const mcp = environment.mcp.filter((tool) =>
    !mcpOff.some((off) =>
      off.server_name === tool.server_name &&
      (off.original_tool === undefined ||
        off.original_tool === tool.original_tool)
    )
  );

  const { contexts, picked } = roles.contextsOf(role, {
    chosen: definition !== null && "contexts" in definition
      ? definition.contexts ?? []
      : [],
    active: environment.active_contexts,
  });

  const value: Omit<ResolvedAgent, "hash"> = {
    agent: copy(agent),
    role,
    place: copy(place),
    name: operator ? given as string : roles.builtinName(role) as string,
    profile: copy(profile ?? environment.default_profile),
    agent_instructions: await sha256Hex(body),
    model: copy(chosen[0] as ModelChoice),
    tools: [...input.tools],
    skills,
    mcp: copy(mcp),
    contexts,
    sources: {
      name: operator ? "agent" : "global",
      profile: profile === undefined ? "global" : "agent",
      agent_instructions: body.length > 0 ? "agent" : "global",
      model: chosen[1],
      tools: "global",
      skills: skillsOff.length > 0 ? "agent" : "global",
      mcp: mcpOff.length > 0 ? "agent" : "global",
      contexts: picked ? "agent" : "global",
    },
  };
  return ok({ ...value, hash: await fingerprint(value) });
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function invalid(
  issues: AgentDefinitionIssue[],
): Result<never, LophnError> {
  return err({
    code: "invalid_input",
    message: "agent cannot be resolved",
    details: { issues },
  });
}
