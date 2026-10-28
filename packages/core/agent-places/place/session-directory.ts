import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AgentAddress,
  AgentAtPlace,
  AgentId,
  CallAgent,
  NamedAgent,
  Place,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  agentNameKey,
  LOPHN_AGENT_ID,
  LOPHN_AGENT_NAME,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  PlaceDeps,
  PlaceRoleRules,
} from "../../lophn-agent/places/ports.ts";

function fail<T = never>(
  code: "not_found" | "invalid_input",
  message: string,
): Result<T> {
  return err({ code, message });
}

// session 목록의 이름과 이름으로 받은 agent 고르기. project·앱·agent 정의 조회가 달라 place 층이 쥔다.
export function createPlaceRoleRules(
  deps: Pick<PlaceDeps, "projects" | "apps" | "agents">,
): PlaceRoleRules {
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

  function resolveAddress(address: AgentAddress): Result<AgentAtPlace> {
    const agent =
      agentNameKey(address.agent) === agentNameKey(LOPHN_AGENT_NAME)
        ? ok(LOPHN_AGENT_ID)
        : agentIdNamed(address.agent);
    if (!agent.ok) return agent;
    const named = address.place;
    let place: Place | null = null;
    if (named !== undefined) {
      if ("project" in named) {
        const project = deps.projects.projectByName(named.project);
        if (project === null) return fail("not_found", "project not found");
        place = { kind: "project", id: project.id };
      } else {
        const app = deps.apps.appByName(named.app);
        if (app === null) return fail("not_found", "app not found");
        place = { kind: "app", id: app.id };
      }
    }
    return ok({ agent: agent.value, place });
  }

  function resolveNamed(named: NamedAgent): Result<CallAgent> {
    const place = named.place;
    switch (named.role) {
      case "lophn":
        return place === undefined && named.name === undefined
          ? ok({ role: "lophn" })
          : fail("invalid_input", "lophn has no place or name");
      case "project_manager": {
        if (place === undefined || !("project" in place)) {
          return fail("invalid_input", "a Project Manager needs a project");
        }
        const project = deps.projects.projectByName(place.project);
        return project === null
          ? fail("not_found", "project not found")
          : ok({ role: "project_manager", project: project.id });
      }
      case "app_engineer": {
        if (place === undefined || !("app" in place)) {
          return fail("invalid_input", "an App Engineer needs an app");
        }
        const app = deps.apps.appByName(place.app);
        return app === null
          ? fail("not_found", "app not found")
          : ok({ role: "app_engineer", app: app.id });
      }
      case "operator": {
        if (named.name === undefined) {
          return fail("invalid_input", "an Operator is named");
        }
        // 정의에 place가 없으므로 주소의 place로 거르지 않는다.
        const matches = deps.agents
          .agents()
          .filter((agent) => agent.name === named.name);
        if (matches.length === 0) {
          return fail("not_found", "agent not found");
        }
        if (matches.length > 1) {
          return fail("invalid_input", "the agent name is ambiguous");
        }
        return ok({ role: "operator", agent: matches[0]!.id });
      }
      case "coding_agent":
        return fail("invalid_input", "a coding agent is not resolved here");
    }
  }

  return {
    nameOf(agent) {
      if (agent === LOPHN_AGENT_ID) return LOPHN_AGENT_NAME;
      return deps.agents.agent(agent)?.name ?? "";
    },
    resolveAddress,
    resolveNamed,
  };
}
