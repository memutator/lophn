import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  CallAgent,
  NamedAgent,
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
    nameOf(ref) {
      switch (ref.role) {
        case "lophn":
          return "lophn";
        case "project_manager":
          return deps.projects.project(ref.project as Id<"prj">)?.name ?? "";
        case "app_engineer":
          return deps.apps.app(ref.app as Id<"app">)?.name ?? "";
        case "operator":
          return deps.agents.agent(ref.agent)?.name ?? "";
      }
    },
    resolveNamed,
  };
}
