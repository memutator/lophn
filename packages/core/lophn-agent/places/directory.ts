import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  CallAgent,
  NamedAgent,
  Place,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { SessionDirectory, TargetSession } from "../../router/ports.ts";
import {
  agentClause,
  agentRefOf,
  type AgentSessionRow,
  loadSession,
  placeOf,
  SESSION_COLUMNS,
  sessionRowOf,
} from "../session/model.ts";
import { startSession } from "./lifecycle.ts";
import { acceptsInput } from "./model.ts";
import type { OpenDeps } from "./ports.ts";

export type SessionDirectoryDeps = OpenDeps & {
  // 지금 transaction의 sql이다. Router가 한 tx 안에서 부르는 find와 openOf, listOpen이 읽는다.
  sql(): Pick<Sql, "get" | "all">;
};

function fail<T = never>(
  code: "not_found" | "invalid_input",
  message: string,
): Result<T> {
  return err({ code, message });
}

// Router가 쓰는 SessionDirectory를 구현한다. lophn session만 다룬다. coding agent 대상은
// coding agent 쪽 구현이 맡는다.
export function createSessionDirectory(
  deps: SessionDirectoryDeps,
): SessionDirectory {
  // 없는 place는 보관한 place와 같이 새 입력을 받지 못한다.
  function placeArchived(place: Place | null): boolean {
    if (place === null) return false;
    const info = place.kind === "project"
      ? deps.projects.project(place.id as Id<"prj">)
      : deps.apps.app(place.id as Id<"app">);
    return info === null || info.archived;
  }

  function targetOf(row: AgentSessionRow): TargetSession {
    return {
      session: row.id as Id<"ses">,
      transport: "lophn",
      agent: agentRefOf(row),
      accepting: acceptsInput(row, placeArchived(placeOf(row))),
    };
  }

  function nameOf(row: AgentSessionRow): string {
    switch (row.role) {
      case "lophn":
        return "lophn";
      case "project_manager":
        return deps.projects.project(row.project as Id<"prj">)?.name ?? "";
      case "app_engineer":
        return deps.apps.app(row.app as Id<"app">)?.name ?? "";
      case "operator":
        return deps.operators.operator(row.operator as Id<"agt">)?.name ?? "";
    }
  }

  // 이름으로 받은 agent 하나를 고른다. 이름을 짐작하지 않는다.
  function resolve(named: NamedAgent): Result<CallAgent> {
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
        let at: Place | null = null;
        if (place !== undefined) {
          const found = "project" in place
            ? deps.projects.projectByName(place.project)
            : deps.apps.appByName(place.app);
          if (found === null) return fail("not_found", "place not found");
          at = "project" in place
            ? { kind: "project", id: found.id }
            : { kind: "app", id: found.id };
        }
        const matches = deps.operators.operators().filter((operator) =>
          operator.name === named.name &&
          (at === null ||
            (operator.place.kind === at.kind && operator.place.id === at.id))
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
    find(session) {
      const row = loadSession({ sql: deps.sql() }, session);
      return row === undefined ? null : targetOf(row);
    },
    resolveAgent: resolve,
    openOf(agent) {
      if (agent.role === "coding_agent") return null;
      const which = agentClause(agent);
      const row = deps.sql().get(
        `select ${SESSION_COLUMNS} from sessions
         where lifecycle = 'open' and (${which.sql})
         order by created_seq desc limit 1`,
        which.params,
      );
      return row === undefined ? null : targetOf(sessionRowOf(row));
    },
    open(tx, agent, _opener) {
      if (agent.role === "coding_agent") {
        return fail(
          "invalid_input",
          "a coding agent session is not opened here",
        );
      }
      const started = startSession(tx, deps, {
        id: tx.newId("ses"),
        agent,
        opening: null,
      });
      return started.ok ? ok(targetOf(started.value)) : started;
    },
    listOpen() {
      return deps.sql().all(
        `select ${SESSION_COLUMNS} from sessions
         where lifecycle = 'open' order by created_seq`,
        [],
      ).map(sessionRowOf).map((row) => ({
        ...targetOf(row),
        name: nameOf(row),
      }));
    },
  };
}
