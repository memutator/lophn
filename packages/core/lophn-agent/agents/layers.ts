import { err, ok, type Result } from "../../../base/mod.ts";
import { contextListRoute } from "../../../protocol/projects/mod.ts";
import {
  type AgentDefinitionIssue,
  agentDefinitionRead,
  agentSessionRead,
  type McpTool,
  type ModelChoice,
  type Place,
  projectModelRead,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import { DEFAULT_PROFILES } from "./builtin.ts";
import type { AgentFileDefinition } from "./definition-file.ts";
import { resolveAgent, type ResolvedAgent } from "./resolve.ts";

// turn을 준비할 때 resolved agent를 만드는 길이다. 층은 core의 읽기 route로 모은다: session(agent와 고른
// model), 정의 파일(전역 기본 model 포함), project 층 model, place의 active context. 정의 파일은 core가
// 읽어 검사한 값이고 runtime은 파일을 직접 열지 않는다. 합치는 규칙은 agents의 resolveAgent다.

// 시작할 수 없는 이유. 영구히 없는 필수 설정·대상이라 turn을 이유와 함께 끝낸다.
export type CannotStart = {
  reason: "configuration_unavailable" | "target_unavailable";
  why: "model_required" | "agent_invalid" | "agent_missing";
};

type RunAgent =
  | { kind: "resolved"; agent: ResolvedAgent }
  | ({ kind: "cannot_start" } & CannotStart);

const MAX_CONTEXT_PAGES = 50;

function cannot(reason: CannotStart["reason"], why: CannotStart["why"]) {
  return ok<RunAgent>({ kind: "cannot_start", reason, why });
}

// 이 place의 agent가 읽을 active context다. project place는 그 project의 context 전부이고, App Engineer는
// 그 앱을 app-data source로 읽는 context 전부다(`context.list`의 app 거르기). lophn은 context 자료가 없다.
async function activeContexts(
  machine: CoreCall,
  place: Place | null,
  role: Role,
): Promise<Result<string[]>> {
  const filter = place === null
    ? null
    : place.kind === "project"
    ? { project: place.id }
    : role === "app_engineer"
    ? { app: place.id }
    : null;
  if (filter === null) return ok([]);
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CONTEXT_PAGES; page += 1) {
    const listed = await readOf(machine, contextListRoute, {
      ...filter,
      status: "active",
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    for (const context of listed.value.contexts) {
      if (context.status === "active") ids.push(context.id);
    }
    if (listed.value.next_cursor === null) return ok(ids);
    cursor = listed.value.next_cursor;
  }
  return err({ code: "unavailable", message: "the context list is too long" });
}

function issueFields(error: { details?: unknown }): string[] {
  const issues =
    (error.details as { issues?: AgentDefinitionIssue[] } | undefined)
      ?.issues;
  return (issues ?? []).map((issue) => issue.field);
}

// 새 turn의 resolved agent를 만든다. 읽지 못한 것(core 연결 실패)은 오류이고, 정의가 틀렸거나 model이 어느
// 층에도 없는 것은 시작할 수 없는 turn이다.
export async function resolveRunAgent(
  machine: CoreCall,
  input: {
    session: string;
    skills: readonly string[];
    // 연결할 수 있는 MCP tool이다. 정의가 서버를 통째로 끈 이름을 먼저 알려 그 서버는 연결하지 않게 한다.
    // 어느 tool을 켜는지는 resolve가 정한다.
    mcp(
      off: ReadonlySet<string>,
      place: Place | null,
    ): Promise<readonly McpTool[]>;
  },
): Promise<Result<RunAgent>> {
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
  const contexts = await activeContexts(machine, place, role);
  if (!contexts.ok) return contexts;

  const definition = read.value.definition as AgentFileDefinition | null;
  const serversOff = new Set(
    (definition?.mcp_off ?? [])
      .filter((entry) => entry.original_tool === undefined)
      .map((entry) => entry.server_name),
  );
  const mcp = await input.mcp(serversOff, place);

  // 정의 읽기의 model은 agent 정의가 먼저이고 비면 전역 기본이다. 출처가 전역일 때만 전역 층의 값이다.
  const effective = read.value.effective.model;
  const globalModel: ModelChoice | null =
    effective !== null && effective.source === "global"
      ? effective.value
      : null;

  // project 층 model은 project place의 agent만 있다. 값이 없으면 null이라 전역 기본을 따른다.
  let projectModel: ModelChoice | null = null;
  if (place?.kind === "project") {
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
    environment: {
      default_profile: DEFAULT_PROFILES[role],
      skills: input.skills,
      mcp,
      active_contexts: contexts.value,
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
