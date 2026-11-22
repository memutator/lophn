// session lifecycle: 앱이 보는 session의 목록, 상태 event, 멈추기. session의 상태는 `state.ts` 한 곳이 정한다.
// 목록은 lophn·harness runtime의 session(ledger의 sessions 표)과 core가 아는 터미널 coding agent(메모리)를 한 모양
// (`SessionInfo`)으로 합친다. event는 agent event(turn·요청·질문·session 시작과 끝)가 올 때 상태를 다시 파생해 바뀌었으면 낸다.
// 앱이 보는 것은 그 앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace의 session뿐이다(`mayReachWorkspace`).
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type CallPolicy,
  mayReachWorkspace,
} from "../../../protocol/lophn-agent/call-policy.ts";
import {
  type SessionEventName,
  type SessionInfo,
  type TerminalSessionReport,
} from "../../../protocol/lophn-agent/session-lifecycle.ts";
import {
  TERMINAL_SESSION_PREFIX,
  terminalSessionId,
} from "../../../protocol/lophn-agent/session-tag.ts";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { SESSION_COLUMNS, sessionRowOf } from "./model.ts";
import { sessionStateOf } from "./state.ts";

type AgentEventLike = {
  type: string;
  session?: string;
};

// 상태를 다시 파생할 agent event. turn·요청·질문이 상태를 움직이고 시작·끝이 session의 있음을 움직인다.
export const LIFECYCLE_AGENT_EVENTS = [
  "SessionStarted",
  "SessionEnded",
  "TurnStarted",
  "TurnEnded",
  "TurnResumed",
  "TurnRequestOpened",
  "TurnRequestClosed",
  "QuestionAsked",
  "QuestionResolved",
] as const;

export type SessionFilter = {
  workspace?: Workspace | { kind: "home" };
  state?: SessionInfo["state"];
  harness?: string;
  kind?: SessionInfo["kind"];
};

export type LifecycleDeps = {
  sql: Pick<Sql, "get" | "all">;
  agent(agent: string): { handle: string; name: string; runtime: string };
  // harness runtime 이름(`claude-code`)을 터미널 coding agent와 같은 harness id(`claude`)로 바꾼다.
  harnessId(runtime: string): string;
  waits(session: string): { approval: boolean; question: boolean };
  // lophn·harness session의 기본 폴더와 workspace 폴더 목록.
  folders(session: string): { cwd: string | null; folders: string[] };
  projectFolders(project: string): string[];
  policy(): CallPolicy;
  emit(
    name: SessionEventName,
    info: SessionInfo,
    audience: (app: string) => boolean,
  ): void;
  // lophn의 event를 구독하겠다고 선언한 앱이 있나. 없으면 session 한 줄을 만들지도 않는다.
  anySubscriber(): boolean;
  // 터미널 탭의 끊기 key를 보낸다. key가 없는 harness는 unavailable이다.
  interruptTerminal(tab: string): Promise<Result<void>>;
  // 도는 turn을 멈춘다(StopTurn).
  stopTurn(turn: string, stateSeq: string): Promise<Result<void>>;
  // 앱이 멈췄음을 사람이 볼 수 있게 남긴다.
  recordAppStop(
    app: string,
    session: string,
    title: string | null,
  ): Promise<void>;
};

const LAST_ACTIVE = `(select max(coalesce(t.finished_at, t.started_at)) from turns t
  where t.session = sessions.id) as last_active_at`;

function workspaceOfRow(
  row: ReturnType<typeof sessionRowOf>,
): Workspace | null {
  return row.workspace_kind === null || row.workspace_id === null
    ? null
    : ({ kind: row.workspace_kind, id: row.workspace_id } as Workspace);
}

export function createSessionLifecycle(deps: LifecycleDeps) {
  const terminals = new Map<string, TerminalSessionReport>();
  // 마지막으로 낸 상태. event를 상태가 바뀔 때만 내려고 쥔다. 처음 보는 session의 앞 상태는 idle이다.
  const known = new Map<string, SessionInfo>();

  function infoOfRow(raw: Record<string, unknown>): SessionInfo {
    const row = sessionRowOf(raw as never);
    const described = deps.agent(row.agent);
    const derived = sessionStateOf(deps.sql, row.id, deps.waits(row.id));
    const active = raw["last_active_at"];
    const where = deps.folders(row.id);
    return {
      session: row.id as SessionInfo["session"],
      kind: row.harness === null ? "lophn" : "harness",
      agent: described,
      // 터미널 coding agent와 같은 harness id(`claude`)로 쓴다(runtime 이름 `claude-code`가 아니다).
      harness: row.harness === null ? null : deps.harnessId(row.harness),
      workspace: workspaceOfRow(row),
      title: row.title,
      state: derived.state,
      waiting_for: derived.waiting_for,
      last_active_at:
        active === null || active === undefined ? null : String(active),
      spawned_by: row.spawned_by as SessionInfo["spawned_by"],
      cwd: where.cwd,
      folders: where.folders,
      terminal: null,
    };
  }

  function rowInfo(session: string, openOnly: boolean): SessionInfo | null {
    const raw = deps.sql.get(
      `select ${SESSION_COLUMNS}, ${LAST_ACTIVE} from sessions where id = ? and harness_gui = 0 and runs_on is null${
        openOnly ? " and lifecycle = 'open'" : ""
      }`,
      [session],
    );
    return raw === undefined ? null : infoOfRow(raw);
  }

  function terminalInfo(report: TerminalSessionReport): SessionInfo {
    return {
      session: terminalSessionId(report.terminal_ref),
      kind: "terminal",
      agent: null,
      harness: report.harness,
      workspace: { kind: "project", id: report.project },
      title: report.title,
      state: report.state,
      waiting_for: report.state === "waiting" ? "approval" : null,
      last_active_at: null,
      spawned_by: null,
      cwd: report.cwd,
      folders: deps.projectFolders(report.project),
      terminal: {
        harness: report.harness,
        cli_session: report.cli_session,
        tab: report.terminal_ref,
        shell_pid: report.shell_pid,
      },
    };
  }

  function visibleTo(app: string, info: SessionInfo): boolean {
    return mayReachWorkspace(
      deps.policy(),
      { kind: "app", id: app } as Workspace,
      info.workspace as Workspace | null,
    );
  }

  function emit(name: SessionEventName, info: SessionInfo): void {
    if (!deps.anySubscriber()) return;
    deps.emit(name, info, (app) => visibleTo(app, info));
  }

  function allOpen(): SessionInfo[] {
    const rows = deps.sql
      .all(
        // GUI 탭의 팀원 session(`harness_gui`)은 그 터미널 session으로 이미 있다. 다른 컴퓨터에서 도는 팀원의 자리는 이 컴퓨터의 session이
        // 아니다. 한 session 읽기(`rowInfo`)도 같다.
        `select ${SESSION_COLUMNS}, ${LAST_ACTIVE} from sessions where lifecycle = 'open' and harness_gui = 0 and runs_on is null order by created_seq`,
        [],
      )
      .map(infoOfRow);
    return [...rows, ...[...terminals.values()].map(terminalInfo)];
  }

  function matches(info: SessionInfo, filter: SessionFilter): boolean {
    if (filter.state !== undefined && info.state !== filter.state) return false;
    if (filter.kind !== undefined && info.kind !== filter.kind) return false;
    if (filter.harness !== undefined && info.harness !== filter.harness) {
      return false;
    }
    if (filter.workspace !== undefined) {
      const want = filter.workspace;
      const have = info.workspace;
      if (want.kind === "home") return have === null;
      if (have === null || have.kind !== want.kind || have.id !== want.id) {
        return false;
      }
    }
    return true;
  }

  // 앱이 볼 수 있는 session 하나. 안 보이면 없는 것과 같다.
  function find(app: string, session: string): SessionInfo | null {
    const info = session.startsWith(TERMINAL_SESSION_PREFIX)
      ? (() => {
          const found = terminals.get(
            session.slice(TERMINAL_SESSION_PREFIX.length),
          );
          return found === undefined ? null : terminalInfo(found);
        })()
      : rowInfo(session, true);
    return info !== null && visibleTo(app, info) ? info : null;
  }

  return {
    list(app: string, filter: SessionFilter): SessionInfo[] {
      return allOpen().filter(
        (info) => visibleTo(app, info) && matches(info, filter),
      );
    },
    find,

    // agent event 하나. 상태가 바뀌었으면 session.<state>를 낸다.
    onAgentEvent(event: AgentEventLike): void {
      const session = event.session;
      if (session === undefined) return;
      if (!deps.anySubscriber()) {
        known.delete(session);
        return;
      }
      if (event.type === "SessionStarted") {
        const info = rowInfo(session, true);
        if (info === null) return;
        known.set(session, info);
        emit("session.started", info);
        return;
      }
      if (event.type === "SessionEnded") {
        const last = known.get(session) ?? rowInfo(session, false);
        known.delete(session);
        if (last !== null) emit("session.ended", last);
        return;
      }
      const info = rowInfo(session, true);
      if (info === null) return;
      const before = known.get(session)?.state ?? "idle";
      known.set(session, info);
      if (info.state !== before && info.state !== "unknown") {
        emit(`session.${info.state}`, info);
      }
    },

    // core의 tracker와 GUI handle이 아는 터미널 coding agent 집합으로 통째로 바꾼다.
    reportTerminals(reports: readonly TerminalSessionReport[]): void {
      const next = new Map(reports.map((one) => [one.terminal_ref, one]));
      for (const [ref, before] of terminals) {
        if (!next.has(ref)) {
          terminals.delete(ref);
          emit("session.ended", terminalInfo(before));
        }
      }
      for (const [ref, report] of next) {
        const before = terminals.get(ref);
        terminals.set(ref, report);
        const info = terminalInfo(report);
        if (before === undefined) {
          emit("session.started", info);
          if (report.state === "running" || report.state === "waiting") {
            emit(`session.${report.state}`, info);
          }
        } else if (
          before.state !== report.state &&
          report.state !== "unknown"
        ) {
          emit(`session.${report.state}`, info);
        }
      }
    },

    async stop(
      app: string,
      session: string,
    ): Promise<Result<{ stopped: boolean }>> {
      const info = find(app, session);
      if (info === null) {
        return err({ code: "not_found", message: "session not found" });
      }
      if (info.kind === "terminal") {
        // 끊기 key는 사람이 쳐 둔 입력도 지운다. 도는 중이거나 물음을 기다리는 터미널에만 보낸다.
        if (info.state !== "running" && info.state !== "waiting") {
          return ok({ stopped: false });
        }
        const sent = await deps.interruptTerminal(info.terminal?.tab ?? "");
        if (!sent.ok) return sent;
        await deps.recordAppStop(app, session, info.title);
        return ok({ stopped: true });
      }
      const turn = deps.sql.get(
        "select id, state_seq from turns where session = ? and state = 'running'",
        [session],
      );
      if (turn === undefined) return ok({ stopped: false });
      const stopped = await deps.stopTurn(
        String(turn["id"]),
        String(turn["state_seq"]),
      );
      if (!stopped.ok) return stopped;
      await deps.recordAppStop(app, session, info.title);
      return ok({ stopped: true });
    },
  };
}

export type SessionLifecycle = ReturnType<typeof createSessionLifecycle>;
