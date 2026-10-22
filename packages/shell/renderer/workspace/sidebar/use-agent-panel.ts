// Agent 모양이 그릴 값: agent 목록과 session 목록을 합친다. agent 목록은 `useSidebarAgents`(AgentsSource.list)가,
// session 목록은 `useSessions()`가 주고, 부르는 쪽(window)이 두 결과를 이 hook에 넣는다.
import { useMemo } from "react";

import type { RunRow, RunStateView } from "./run-list.tsx";
import type { SidebarAgent, SidebarAgentRole } from "./sidebar-agent.ts";

/** Agent 모양이 쓰는 session 한 줄. `useSessions()`의 항목에서 부르는 쪽이 옮긴다. */
export interface PanelSession {
  readonly id: string;
  readonly title: string;
  /** 이 session을 가진 agent의 `asg_…`. */
  readonly agent: string;
  /** 사람을 기다림, 일하는 중, 그 밖(쉬는 중·알 수 없음). */
  readonly status: "waiting" | "working" | "idle";
  /** 열려 있는 session인가. 끝났거나 보관한 session은 Recent에만 오른다. */
  readonly open: boolean;
  /** 마지막으로 움직인 때(epoch ms). */
  readonly at: number;
}

/** project sidebar의 run 한 줄. hr-screen-data가 run 기록에서 옮긴다(agent run만). */
export interface PanelRun {
  readonly id: string;
  /** 받는 agent 줄의 `SidebarAgent.assignment`. */
  readonly agent: string;
  /** job이 연 run이면 그 job의 제목. */
  readonly title: string | null;
  readonly state: RunStateView;
  /** 시작한 때(epoch ms, `created_at`). */
  readonly at: number;
  /** run이 연 session(`session_opened`). 부르는 쪽은 이 session을 `sessions`에서 빼고 넘긴다. `--session` run은 null. */
  readonly session: PanelSession | null;
}

export interface AgentGroup {
  readonly agent: SidebarAgent;
  /** 열린 session. 최근에 움직인 것이 위다. */
  readonly sessions: readonly PanelSession[];
}

interface RecentSession {
  readonly session: PanelSession;
  readonly agentName: string;
}

export interface AgentPanelView {
  /** lophn · Project Manager 순서의 묶음. */
  readonly builtins: readonly AgentGroup[];
  /** Operator들(들어온 순서). */
  readonly operators: readonly AgentGroup[];
  /** 새것부터 `RECENT_LIMIT`개. 비면 묶음이 없다. */
  readonly runs: readonly RunRow[];
  readonly recent: readonly RecentSession[];
}

const RECENT_LIMIT = 5;

const BUILTIN_ORDER: Partial<Record<SidebarAgentRole, number>> = {
  lophn: 0,
  project_manager: 1,
};

function agentPanelOf(
  agents: readonly SidebarAgent[],
  sessions: readonly PanelSession[],
  runs: readonly PanelRun[],
): AgentPanelView {
  const byRecent = [...sessions].sort((a, b) => b.at - a.at);
  const group = (agent: SidebarAgent): AgentGroup => ({
    agent,
    sessions: byRecent.filter((s) => s.open && s.agent === agent.assignment),
  });
  const builtins = agents
    .filter((agent) => agent.role !== "operator")
    .sort((a, b) =>
      (BUILTIN_ORDER[a.role] ?? 9) - (BUILTIN_ORDER[b.role] ?? 9)
    );
  const names = new Map(agents.map((a) => [a.assignment, a]));
  return {
    builtins: builtins.map(group),
    operators: agents.filter((agent) => agent.role === "operator").map(group),
    // job이 시간마다 run을 만들어도 sidebar가 자라지 않게 새것 몇 개만 보인다.
    runs: [...runs].sort((a, b) => b.at - a.at)
      .flatMap((run) => {
        const agent = names.get(run.agent);
        return agent === undefined ? [] : [{
          id: run.id,
          name: run.title ?? agent.name,
          via: run.title === null ? null : agent.name,
          profile: agent.profile,
          state: run.state,
          at: run.at,
          session: run.session,
        }];
      })
      .slice(0, RECENT_LIMIT),
    recent: byRecent.filter((s) => !s.open && names.has(s.agent))
      .slice(0, RECENT_LIMIT)
      .map((session) => ({
        session,
        agentName: names.get(session.agent)!.name,
      })),
  };
}

const NO_RUNS: readonly PanelRun[] = [];

export function useAgentPanel(
  agents: readonly SidebarAgent[],
  sessions: readonly PanelSession[],
  runs: readonly PanelRun[] = NO_RUNS,
): AgentPanelView {
  return useMemo(
    () => agentPanelOf(agents, sessions, runs),
    [agents, sessions, runs],
  );
}
