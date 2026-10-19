import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  CallAgent,
  NamedAgent,
  Place,
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

// session 목록의 이름과 이름으로 받은 agent 고르기. project·앱·Operator 조회가 role마다 달라 role 층이 쥔다.
export function createPlaceRoleRules(
  deps: Pick<PlaceDeps, "projects" | "operators">,
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
      case "operator": {
        if (named.name === undefined) {
          return fail("invalid_input", "an Operator is named");
        }
        let at: Place | null = null;
        if (place !== undefined) {
          if (!("project" in place)) {
            return fail("invalid_input", "an Operator lives in a project");
          }
          const found = deps.projects.projectByName(place.project);
          if (found === null) return fail("not_found", "place not found");
          at = { kind: "project", id: found.id };
        }
        const matches = deps.operators.operators().filter((operator) =>
          operator.name === named.name &&
          (at === null || operator.place.id === at.id)
        );
        if (matches.length === 0) {
          return fail("not_found", "operator not found");
        }
        if (matches.length > 1) {
          return fail("invalid_input", "the operator name is ambiguous");
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
        case "operator":
          return deps.operators.operator(ref.agent)?.name ?? "";
      }
    },
    resolveNamed,
  };
}
