import { ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinitionIssue,
  agentDefinitionRead,
  agentSessionRead,
  type McpServer,
  type McpTool,
  type ModelChoice,
  type Place,
  projectModelRead,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import type { AgentFileDefinition } from "./definition-file.ts";
import type { AgentRoleTable } from "./role-table.ts";
import {
  type AvailableSkill,
  resolveAgent,
  type ResolvedAgent,
} from "./resolve.ts";

// turn을 준비할 때 resolved agent를 만드는 길이다. 층은 core의 읽기 route로 모은다: session(agent와 고른
// model), 정의 파일(전역 기본 model 포함), project 층 model. 정의 파일은 core가
// 읽어 검사한 값이고 runtime은 파일을 직접 열지 않는다. 합치는 규칙은 agents의 resolveAgent다.

// 시작할 수 없는 이유. 영구히 없는 필수 설정·대상이라 turn을 이유와 함께 끝낸다.
export type CannotStart = {
  reason: "configuration_unavailable" | "target_unavailable";
  why: "model_required" | "agent_invalid" | "agent_missing";
};

type TurnAgent =
  | { kind: "resolved"; agent: ResolvedAgent }
  | ({ kind: "cannot_start" } & CannotStart);

function cannot(reason: CannotStart["reason"], why: CannotStart["why"]) {
  return ok<TurnAgent>({ kind: "cannot_start", reason, why });
}

function issueFields(error: { details?: unknown }): string[] {
  const issues =
    (error.details as { issues?: AgentDefinitionIssue[] } | undefined)
      ?.issues;
  return (issues ?? []).map((issue) => issue.field);
}

// 새 turn의 resolved agent를 만든다. 읽지 못한 것(core 연결 실패)은 오류이고, 정의가 틀렸거나 model이 어느
// 층에도 없는 것은 시작할 수 없는 turn이다.
export async function resolveTurnAgent(
  machine: CoreCall,
  input: {
    session: string;
    skills: readonly AvailableSkill[];
    // role이 고정한 tool 이름 목록이다. role은 정의를 읽어야 알므로 함수로 받는다.
    roleTools(role: Role): readonly string[];
    // role마다 다른 값과 규칙. role 층이 정해 조립이 넘긴다.
    roles: AgentRoleTable;
    // 연결할 수 있는 MCP tool이다. 정의가 서버를 통째로 끈 이름을 먼저 알려 그 서버는 연결하지 않게 한다.
    // 어느 tool을 켜는지는 resolve가 정한다.
    // servers는 Operator 정의가 가진 서버다. 다른 role과 정의가 없는 agent는 비어 있다.
    mcp(
      off: ReadonlySet<string>,
      place: Place | null,
      servers?: readonly McpServer[],
    ): Promise<readonly McpTool[]>;
  },
): Promise<Result<TurnAgent>> {
  // 이 session이 고른 model은 가장 높은 층이다. turn을 준비하는 지금 읽은 값이 이 turn에 고정되고, 그 뒤에
  // 바뀐 선택은 다음 turn부터 쓴다.
  const sessionRecord = await readOf(machine, agentSessionRead, {
    session: input.session as never,
  });
  if (!sessionRecord.ok) return sessionRecord;
  const session = sessionRecord.value.session;

  const read = await readOf(machine, agentDefinitionRead, {
    agent: session.agent,
  });
  if (!read.ok) {
    return read.error.code === "not_found"
      ? cannot("target_unavailable", "agent_missing")
      : read;
  }
  if (read.value.issues.length > 0) {
    return cannot("configuration_unavailable", "agent_invalid");
  }

  const { role, place } = read.value;
  const definition = read.value.definition as AgentFileDefinition | null;
  const serversOff = new Set(
    (definition?.mcp_off ?? [])
      .filter((entry) => entry.original_tool === undefined)
      .map((entry) => entry.server_name),
  );
  const ownServers = definition !== null && "mcp_servers" in definition
    ? definition.mcp_servers ?? []
    : [];
  const mcp = await input.mcp(serversOff, place, ownServers);

  // 정의 읽기의 model은 agent 정의가 먼저이고 비면 전역 기본이다. 출처가 전역일 때만 전역 층의 값이다.
  const effective = read.value.effective.model;
  const globalModel: ModelChoice | null =
    effective !== null && effective.source === "global"
      ? effective.value
      : null;

  // project 층 model은 project place의 agent만 있다. 값이 없으면 null이라 전역 기본을 따른다.
  let projectModel: ModelChoice | null = null;
  if (place) {
    const project = await readOf(machine, projectModelRead, {
      project: place.id,
    });
    if (!project.ok) return project;
    projectModel = project.value.model;
  }

  const resolved = await resolveAgent({
    agent: session.agent,
    place,
    definition,
    global_model: globalModel,
    project_model: projectModel,
    session_model: session.model_selection,
    tools: input.roleTools(role),
    roles: input.roles,
    environment: {
      default_profile: input.roles.defaultProfile(role),
      skills: input.skills,
      mcp,
    },
  });
  if (resolved.ok) {
    return ok({ kind: "resolved", agent: resolved.value });
  }
  if (resolved.error.code === "not_found") {
    return cannot("target_unavailable", "agent_missing");
  }
  if (resolved.error.code === "invalid_input") {
    return issueFields(resolved.error).includes("model")
      ? cannot("configuration_unavailable", "model_required")
      : cannot("configuration_unavailable", "agent_invalid");
  }
  return resolved;
}
