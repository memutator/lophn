import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AgentAddress,
  AgentAtWorkspace,
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  agentHandleKey,
  LOPHN_AGENT_HANDLE,
  lophnIdOf,
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

// session 목록의 agent 표시와 handle로 받은 agent 고르기. project·앱·agent 정의 조회가 달라 workspace 층이 쥔다.
// 범위 agent의 workspace 검사는 session을 열 때(startSession) 한다. 여기서는 handle만 푼다.
export function createWorkspaceNameRules(
  deps: Pick<WorkspaceDeps, "projects" | "apps" | "agents">,
): WorkspaceNameRules {
  // handle은 전역에 하나다. 같은 key를 쓰는 정의 하나를 고른다.
  function agentIdByHandle(handle: string): Result<AgentId> {
    const key = agentHandleKey(handle);
    const found = deps.agents
      .agents()
      .find((agent) => agentHandleKey(agent.handle) === key);
    return found === undefined
      ? fail("not_found", "agent not found")
      : ok(found.id);
  }

  // handle `lophn`은 workspace마다 하나라 workspace와 짝으로 풀린다. workspace가 없으면 Home이고, call은 Router가 부른 쪽의
  // workspace로 바꾼다. 다른 agent는 handle로 전역에 하나다.
  function resolveAddress(address: AgentAddress): Result<AgentAtWorkspace> {
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
    const agent =
      agentHandleKey(address.agent) === agentHandleKey(LOPHN_AGENT_HANDLE)
        ? ok(lophnIdOf(workspace))
        : agentIdByHandle(address.agent);
    if (!agent.ok) return agent;
    return ok({ agent: agent.value, workspace });
  }

  return {
    describe(agent) {
      const info = deps.agents.agent(agent);
      return info === null
        ? { handle: agent, name: agent }
        : { handle: info.handle, name: info.name };
    },
    resolveAddress,
  };
}
