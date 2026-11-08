import { err, ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Workspace } from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { SessionDirectory, TargetSession } from "../../router/ports.ts";
import {
  type AgentSessionRow,
  loadSession,
  workspaceOf,
  SESSION_COLUMNS,
  sessionRowOf,
} from "../session/model.ts";
import { teamLimitsAt } from "../../config/setting-declarations.ts";
import { DEFAULT_TEAM_LIMITS } from "../../../protocol/lophn-agent/team.ts";
import { dataRootOf } from "../agents/mod.ts";
import { checkSpawnSlot, startSession } from "./lifecycle.ts";
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
  // 없는 workspace는 보관한 workspace와 같이 새 입력을 받지 못한다.
  function workspaceArchived(workspace: Workspace | null): boolean {
    if (workspace === null) return false;
    const info =
      workspace.kind === "project"
        ? deps.projects.project(workspace.id as Id<"prj">)
        : deps.apps.app(workspace.id as Id<"app">);
    return info === null || info.archived;
  }

  function targetOf(row: AgentSessionRow): TargetSession {
    return {
      session: row.id as Id<"ses">,
      transport: row.harness === null ? "lophn" : "harness",
      agent: { agent: row.agent, workspace: workspaceOf(row) },
      accepting: acceptsInput(row, workspaceArchived(workspaceOf(row))),
      spawned_by: row.spawned_by as Id<"ses"> | null,
    };
  }

  return {
    find(session) {
      const row = loadSession({ sql: deps.sql() }, session);
      return row === undefined ? null : targetOf(row);
    },
    resolveAddress: deps.names.resolveAddress,
    open(tx, agent, opener, spawnedBy) {
      if (spawnedBy !== null) {
        // writer Worker 안에서 설정 파일을 읽는다. 읽지 못하면 기본 상한이다.
        const root = dataRootOf(tx.sql, undefined);
        const slot = checkSpawnSlot(
          tx,
          spawnedBy,
          root.ok ? teamLimitsAt(root.value) : DEFAULT_TEAM_LIMITS,
        );
        if (!slot.ok) return slot;
      }
      // archived 앱은 agent에게 없는 앱이다. 사람과 program은 conflict로 닫힘을 안다.
      if (
        opener.kind === "agent" &&
        agent.workspace?.kind === "app" &&
        deps.apps.app(agent.workspace.id as Id<"app">)?.archived === true
      ) {
        return err({ code: "not_found", message: "app not found" });
      }
      // 다른 workspace의 session이 불러 열린 session은 부른 workspace를 남긴다.
      const sender =
        opener.kind === "agent"
          ? loadSession({ sql: tx.sql }, opener.session)
          : undefined;
      const from = sender === undefined ? null : workspaceOf(sender);
      const started = startSession(tx, deps, {
        id: tx.newId("ses"),
        agent: agent.agent,
        workspace: agent.workspace,
        calledFrom:
          from !== null &&
          (agent.workspace === null ||
            agent.workspace.kind !== from.kind ||
            agent.workspace.id !== from.id)
            ? from
            : null,
        spawnedBy,
      });
      return started.ok ? ok(targetOf(started.value)) : started;
    },
    accepts(agent) {
      const info = deps.agents.agent(agent);
      const card = info === null ? null : deps.agents.cardOf(info.handle);
      return card === null
        ? null
        : {
            name: card.name,
            input: card.modality.input,
            replies: card.replies,
          };
    },
    listOpen() {
      // 마지막 활동은 session 목록 read와 같은 기준이다(마지막 turn이 끝난, 없으면 시작한 시각).
      const rows = deps.sql().all(
        `select ${SESSION_COLUMNS},
           (select max(coalesce(t.finished_at, t.started_at)) from turns t
            where t.session = sessions.id) as last_active_at
         from sessions where lifecycle = 'open' order by created_seq`,
        [],
      );
      return rows.map((raw) => {
        const row = sessionRowOf(raw);
        const active = raw["last_active_at"];
        const described = deps.names.describe(row.agent);
        return {
          ...targetOf(row),
          ...described,
          description:
            deps.agents.cardOf(described.handle)?.description ?? null,
          runtime: deps.agents.agent(row.agent)?.runtime ?? "lophn",
          title: row.title,
          last_active_at:
            active === null || active === undefined ? null : String(active),
        };
      });
    },
  };
}
