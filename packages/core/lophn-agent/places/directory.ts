import { ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type Place,
  placeOfAgentRef,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { SessionDirectory, TargetSession } from "../../router/ports.ts";
import { agentIdOfRef } from "../agents/bridge.ts";
import {
  type AgentSessionRow,
  loadSession,
  placeOf,
  SESSION_COLUMNS,
  sessionClause,
  sessionRowOf,
} from "../session/model.ts";
import { startSession } from "./lifecycle.ts";
import { acceptsInput } from "./model.ts";
import type { OpenDeps } from "./ports.ts";

type SessionDirectoryDeps = OpenDeps & {
  // 지금 transaction의 sql이다. Router가 한 tx 안에서 부르는 find와 openOf, listOpen이 읽는다.
  sql(): Pick<Sql, "get" | "all">;
};

// Router가 쓰는 SessionDirectory를 구현한다. session 행이 곧 받는 곳이다.
export function createSessionDirectory(
  deps: SessionDirectoryDeps,
): SessionDirectory {
  // 없는 place는 보관한 place와 같이 새 입력을 받지 못한다.
  function placeArchived(place: Place | null): boolean {
    if (place === null) return false;
    const info =
      place.kind === "project"
        ? deps.projects.project(place.id as Id<"prj">)
        : deps.apps.app(place.id as Id<"app">);
    return info === null || info.archived;
  }

  function targetOf(row: AgentSessionRow): TargetSession {
    return {
      session: row.id as Id<"ses">,
      transport: "lophn",
      agent: { agent: row.agent, place: placeOf(row) },
      accepting: acceptsInput(row, placeArchived(placeOf(row))),
    };
  }

  return {
    find(session) {
      const row = loadSession({ sql: deps.sql() }, session);
      return row === undefined ? null : targetOf(row);
    },
    resolveAddress: deps.roles.resolveAddress,
    resolveAgent: deps.roles.resolveNamed,
    openOf(agent) {
      if (agent.role === "coding_agent") return null;
      const id = agentIdOfRef(agent);
      if (id === null) return null;
      const which = sessionClause(id, placeOfAgentRef(agent) ?? null);
      const row = deps.sql().get(
        `select ${SESSION_COLUMNS} from sessions
         where lifecycle = 'open' and (${which.sql})
         order by created_seq desc limit 1`,
        which.params,
      );
      return row === undefined ? null : targetOf(sessionRowOf(row));
    },
    open(tx, agent, _opener) {
      const started = startSession(tx, deps, {
        id: tx.newId("ses"),
        agent: agent.agent,
        place: agent.place,
      });
      return started.ok ? ok(targetOf(started.value)) : started;
    },
    listOpen() {
      return deps
        .sql()
        .all(
          `select ${SESSION_COLUMNS} from sessions
         where lifecycle = 'open' order by created_seq`,
          [],
        )
        .map(sessionRowOf)
        .map((row) => ({
          ...targetOf(row),
          name: deps.roles.nameOf(row.agent),
        }));
    },
  };
}
