import { ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Place } from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { SessionDirectory, TargetSession } from "../../router/ports.ts";
import {
  type AgentSessionRow,
  loadSession,
  placeOf,
  SESSION_COLUMNS,
  sessionRowOf,
} from "../session/model.ts";
import { startSession } from "./lifecycle.ts";
import { acceptsInput } from "./model.ts";
import type { OpenDeps } from "./ports.ts";

type SessionDirectoryDeps = OpenDeps & {
  // 지금 transaction의 sql이다. Router가 한 tx 안에서 부르는 find와 listOpen이 읽는다.
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
    resolveAddress: deps.names.resolveAddress,
    open(tx, agent, _opener) {
      const started = startSession(tx, deps, {
        id: tx.newId("ses"),
        agent: agent.agent,
        place: agent.place,
      });
      return started.ok ? ok(targetOf(started.value)) : started;
    },
    accepts(agent) {
      const info = deps.agents.agent(agent);
      const card = info === null ? null : deps.agents.cardOf(info.name);
      return card === null
        ? null
        : {
            name: card.name,
            input: card.modality.input,
            replies: card.replies,
          };
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
          name: deps.names.nameOf(row.agent),
        }));
    },
  };
}
