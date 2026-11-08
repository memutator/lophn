import { ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinitionIssue,
  agentRead,
  type McpServer,
  type McpTool,
  type ModelChoice,
  type Workspace,
  type WorkspaceKind,
  workspaceKindOf,
  workspaceSessionRead,
  workspaceKeyOf,
  workspaceModelRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import type { AgentFileDefinition } from "./definition-file.ts";
import {
  type AvailableSkill,
  resolveAgent,
  type ResolvedAgent,
} from "./resolve.ts";

// turn을 준비할 때 resolved agent를 만드는 길이다. session(agent id와 workspace, 고른 model), agent 정의,
// workspace 층 model을 core의 읽기 route로 모은다. 합치는 규칙은 agents의 resolveAgent다.

export type CannotStart = {
  reason: "configuration_unavailable" | "target_unavailable" | "model_required";
  why: "model_required" | "agent_invalid" | "agent_missing";
};

type TurnAgent =
  | { kind: "resolved"; agent: ResolvedAgent }
  | ({ kind: "cannot_start" } & CannotStart);

function cannot(reason: CannotStart["reason"], why: CannotStart["why"]) {
  return ok<TurnAgent>({ kind: "cannot_start", reason, why });
}

function issueFields(error: { details?: unknown }): string[] {
  const issues = (
    error.details as { issues?: AgentDefinitionIssue[] } | undefined
  )?.issues;
  return (issues ?? []).map((issue) => issue.field);
}

export async function resolveTurnAgent(
  machine: CoreCall,
  input: {
    session: string;
    skills: readonly AvailableSkill[];
    workspaceTools(kind: WorkspaceKind): readonly string[];
    // 연결할 수 있는 MCP tool이다. 정의가 서버를 통째로 끈 이름을 먼저 알려 그 서버는 연결하지 않게 한다.
    mcp(
      off: ReadonlySet<string>,
      workspace: Workspace | null,
      servers?: readonly McpServer[],
    ): Promise<readonly McpTool[]>;
  },
): Promise<Result<TurnAgent>> {
  const sessionRecord = await readOf(machine, workspaceSessionRead, {
    session: input.session as never,
  });
  if (!sessionRecord.ok) return sessionRecord;
  const session = sessionRecord.value.session;
  const agent = session.agent;

  const read = await readOf(machine, agentRead, {
    agent,
    ...(session.workspace === null ? {} : { workspace: session.workspace }),
  });
  if (!read.ok) {
    return read.error.code === "not_found"
      ? cannot("target_unavailable", "agent_missing")
      : read;
  }
  if (read.value.issues.length > 0) {
    return cannot("configuration_unavailable", "agent_invalid");
  }

  const workspace = session.workspace;
  const kind = workspaceKindOf(workspace);
  const definition = read.value.definition as AgentFileDefinition | null;
  const serversOff = new Set(
    (definition?.mcp_off ?? [])
      .filter((entry) => entry.original_tool === undefined)
      .map((entry) => entry.server_name),
  );
  const mcp = await input.mcp(
    serversOff,
    workspace,
    definition?.mcp_servers ?? [],
  );

  const effective = read.value.effective.model;
  const globalModel: ModelChoice | null =
    effective !== null && effective.source === "global"
      ? effective.value
      : null;

  const own = await readOf(machine, workspaceModelRead, {
    workspace: workspaceKeyOf(workspace),
  });
  if (!own.ok) return own;

  const resolved = await resolveAgent({
    agent,
    workspace,
    called_from: session.called_from,
    definition,
    global_model: globalModel,
    workspace_model: own.value.model,
    session_model: session.model_selection,
    tools: input.workspaceTools(kind),
    environment: {
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
      ? cannot("model_required", "model_required")
      : cannot("configuration_unavailable", "agent_invalid");
  }
  return resolved;
}
