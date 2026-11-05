import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AgentAddress,
  AgentAtWorkspace,
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  agentNameKey,
  LOPHN_AGENT_ID,
  LOPHN_AGENT_NAME,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  WorkspaceDeps,
  WorkspaceNameRules,
} from "../../lophn-agent/workspaces/ports.ts";

function fail<T = never>(
  code: "not_found" | "invalid_input",
  message: string,
): Result<T> {
  return err({ code, message });
}

// session 목록의 이름과 이름으로 받은 agent 고르기. project·앱·agent 정의 조회가 달라 workspace 층이 쥔다.
export function createWorkspaceNameRules(
  deps: Pick<WorkspaceDeps, "projects" | "apps" | "agents">,
): WorkspaceNameRules {
  // agent 이름은 전역에 하나다. 같은 key를 쓰는 정의 하나를 고른다.
  function agentIdNamed(name: string): Result<AgentId> {
    const key = agentNameKey(name);
    const found = deps.agents
      .agents()
      .find((agent) => agentNameKey(agent.name) === key);
    return found === undefined
      ? fail("not_found", "agent not found")
      : ok(found.id);
  }

  function resolveAddress(address: AgentAddress): Result<AgentAtWorkspace> {
    const agent =
      agentNameKey(address.agent) === agentNameKey(LOPHN_AGENT_NAME)
        ? ok(LOPHN_AGENT_ID)
        : agentIdNamed(address.agent);
    if (!agent.ok) return agent;
    const named = address.workspace;
    let workspace: Workspace | null = null;
    if (named !== undefined) {
      if ("project" in named) {
        const project = deps.projects.projectByName(named.project);
        if (project === null) return fail("not_found", "project not found");
        workspace = { kind: "project", id: project.id };
      } else {
        const app = deps.apps.appByName(named.app);
        if (app === null) return fail("not_found", "app not found");
        workspace = { kind: "app", id: app.id };
      }
    }
    return ok({ agent: agent.value, workspace });
  }

  return {
    nameOf(agent) {
      if (agent === LOPHN_AGENT_ID) return LOPHN_AGENT_NAME;
      return deps.agents.agent(agent)?.name ?? "";
    },
    resolveAddress,
  };
}
