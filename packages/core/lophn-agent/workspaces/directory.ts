import { err, ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  isCodingBuiltin,
  type Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import type { SessionDirectory, TargetSession } from "../../router/ports.ts";
import {
  type AgentSessionRow,
  loadSession,
  nextSessionSeq,
  workspaceOf,
  SESSION_COLUMNS,
  sessionRowOf,
} from "../session/model.ts";
import { teamLimitsAt } from "../../config/setting-declarations.ts";
import { DEFAULT_TEAM_LIMITS } from "../../../protocol/lophn-agent/team.ts";
import { dataRootOf } from "../agents/mod.ts";
import {
  checkSpawnSlot,
  endSession,
  startMemberSession,
  startSession,
} from "./lifecycle.ts";
import { acceptsInput } from "./model.ts";
import type { EndDeps, OpenDeps } from "./ports.ts";

type SessionDirectoryDeps = OpenDeps & {
  // 지금 transaction의 sql이다. Router가 한 tx 안에서 부르는 find와 listOpen이 읽는다.
  sql(): Pick<Sql, "get" | "all">;
  // session을 끝낼 때의 영향(archive). 읽기만 하는 directory는 없다.
  end?: EndDeps;
};

// Router가 쓰는 SessionDirectory를 구현한다. session 행이 곧 받는 곳이다. project 정체는 projects module의 것이라 wiring이 더한다.
export function createSessionDirectory(
  deps: SessionDirectoryDeps,
): Omit<SessionDirectory, "projectOfIdentity" | "identityOfProject"> {
  // 없는 workspace는 보관한 workspace와 같이 새 입력을 받지 못한다.
  function workspaceArchived(workspace: Workspace | null): boolean {
    if (workspace === null) return false;
    const info =
      workspace.kind === "project"
        ? deps.projects.project(workspace.id as Id<"prj">)
        : deps.apps.app(workspace.id as Id<"app">);
    return info === null || info.archived;
  }

  // 부모 밑에 자식 하나가 더 들어가도 팀이 상한 안인지. 설정 파일은 writer Worker 안에서 읽고, 읽지 못하면 기본 상한이다.
  function spawnSlot(tx: Tx, parent: Id<"ses">) {
    const root = dataRootOf(tx.sql, undefined);
    return checkSpawnSlot(
      tx,
      parent,
      root.ok ? teamLimitsAt(root.value) : DEFAULT_TEAM_LIMITS,
    );
  }

  function targetOf(row: AgentSessionRow): TargetSession {
    return {
      session: row.id as Id<"ses">,
      transport: row.harness === null ? "lophn" : "harness",
      agent: { agent: row.agent, workspace: workspaceOf(row) },
      // 다른 컴퓨터에서 도는 팀원은 이 기계의 queue로 받지 않는다.
      accepting:
        row.runs_on === null &&
        acceptsInput(row, workspaceArchived(workspaceOf(row))),
      open: row.lifecycle === "open",
      spawned_by: row.spawned_by as Id<"ses"> | null,
      opened_by_machine: row.opened_by_machine as Id<"mch"> | null,
      runs_on: row.runs_on as Id<"mch"> | null,
    };
  }

  return {
    find(session) {
      const row = loadSession({ sql: deps.sql() }, session);
      return row === undefined ? null : targetOf(row);
    },
    resolveAddress: deps.names.resolveAddress,
    openMember(tx, parent, handle, machine) {
      const slot = spawnSlot(tx, parent);
      if (!slot.ok) return slot;
      const sender = loadSession({ sql: tx.sql }, parent);
      if (sender === undefined) {
        return err({ code: "not_found", message: "session not found" });
      }
      const started = startMemberSession(tx, {
        id: tx.newId("ses"),
        handle,
        workspace: workspaceOf(sender),
        parent,
        machine,
      });
      return started.ok ? ok(targetOf(started.value)) : started;
    },
    archive(tx, session) {
      const row = loadSession(tx, session);
      if (row === undefined || row.lifecycle !== "open") return ok(false);
      if (deps.end === undefined) {
        return err({
          code: "unavailable",
          message: "sessions cannot end here",
        });
      }
      tx.sql.run(
        "update sessions set lifecycle = 'archived', state_seq = ? where id = ?",
        [nextSessionSeq(tx), row.id],
      );
      const ended = endSession(tx, deps.end, row, "archived");
      return ended.ok ? ok(true) : ended;
    },
    membersOn(tx, machine) {
      return tx.sql
        .all(
          "select id from sessions where runs_on = ? and lifecycle = 'open' order by created_seq",
          [machine],
        )
        .map((row) => String(row["id"]) as Id<"ses">);
    },
    membersUnder(tx, parent) {
      return tx.sql
        .all(
          "select id from sessions where spawned_by = ? and runs_on is not null and lifecycle = 'open' order by created_seq",
          [parent],
        )
        .map((row) => String(row["id"]) as Id<"ses">);
    },
    open(tx, agent, opener, spawnedBy, options) {
      const member = options?.member;
      if (member !== undefined && loadSession({ sql: tx.sql }, member.id)) {
        return err({ code: "not_found", message: "that session id is taken" });
      }
      // 다른 컴퓨터가 연 팀원은 잎이다: 이 컴퓨터에 자식을 열지 못한다(팀 규칙과 상한은 연 기계가 센다).
      const parent =
        spawnedBy === null ? undefined : loadSession(tx, spawnedBy);
      if (
        parent !== undefined &&
        parent.opened_by_machine !== null &&
        parent.spawned_by !== null
      ) {
        return err({
          code: "conflict",
          message:
            "a team member opened from another computer does not spawn; do the work yourself or ask your parent",
        });
      }
      if (spawnedBy !== null) {
        // writer Worker 안에서 설정 파일을 읽는다. 읽지 못하면 기본 상한이다.
        const slot = spawnSlot(tx, spawnedBy);
        if (!slot.ok) return slot;
      }
      // archived 앱은 agent에게 없는 앱이다. 사람과 program은 conflict로 닫힘을 안다.
      if (
        (opener.kind === "agent" ||
          opener.kind === "app" ||
          opener.kind === "remote") &&
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
      const from: Workspace | null =
        opener.kind === "app"
          ? { kind: "app", id: opener.app }
          : sender === undefined
            ? null
            : workspaceOf(sender);
      const started = startSession(tx, deps, {
        id: member?.id ?? tx.newId("ses"),
        agent: agent.agent,
        workspace: agent.workspace,
        calledFrom:
          from !== null &&
          (agent.workspace === null ||
            agent.workspace.kind !== from.kind ||
            agent.workspace.id !== from.id)
            ? from
            : null,
        spawnedBy: member?.parent ?? spawnedBy,
        // 앱이 불러 열린 session은 그 앱이 끝낼 수 있다.
        openedByApp: opener.kind === "app" ? opener.app : null,
        // project에서 부른 내장 coding agent는 그 project의 GUI 탭 팀원으로 연다(core가 탭을 연다). 다른 곳은 headless다.
        // 탭은 core가 열어야 하므로 사람이 coding agent를 lophn이 돌리게 켰을 때만 열린다(꺼져 있으면 unavailable).
        ...(isCodingBuiltin(agent.agent) && agent.workspace?.kind === "project"
          ? { gui: "called" as const }
          : {}),
        // 다른 컴퓨터의 mail이 연 session은 다른 컴퓨터로 보내지 못한다. 부른 workspace는 이 기계의 것이 아니라 남기지 않는다.
        openedByMachine: opener.kind === "remote" ? opener.machine : null,
        skipAllowed: options?.skipAllowed,
      });
      return started.ok ? ok(targetOf(started.value)) : started;
    },
    appIdOf(app) {
      const found = deps.apps.appByName(app);
      return found.ok ? ok(found.value.id) : found;
    },
    app(id) {
      const info = deps.apps.app(id as Id<"app">);
      return info === null
        ? null
        : { slug: info.name, archived: info.archived };
    },
    accepts(agent) {
      const info = deps.agents.agent(agent);
      const card =
        info === null ? null : deps.agents.cardOf(info.handle, info.workspace);
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
            deps.agents.cardOf(described.handle, workspaceOf(row))
              ?.description ?? null,
          runtime: deps.agents.agent(row.agent)?.runtime ?? "lophn",
          title: row.title,
          last_active_at:
            active === null || active === undefined ? null : String(active),
        };
      });
    },
  };
}
