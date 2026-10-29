// Agent 모양이 그릴 값: agent 목록, lophn session, 터미널 coding agent session, run을 한 view로 합친다.
// agent 목록은 `useSidebarAgents`(AgentsSource.list)가, session 목록은 `useSessions()`가, 터미널 session은
// `usePanelTerminals`가 주고, 부르는 쪽(window)이 결과를 이 hook에 넣는다.
// 위에서부터 Agents(lophn agent만), Current(이 창에 탭이 열린 lophn session과 터미널 session), Background(run),
// Recent(탭을 닫은 lophn session과 저장한 터미널 session)다. Current와 Recent는 새것부터 섞어 늘어놓는다.
// 상태 점과 제목은 탭 줄과 같은 값이다(부르는 쪽이 탭의 `dotOf`와 `title`을 넣는다).
import { useMemo } from "react";

import type { TabDot } from "../../parts/tab-state-dot/tab-state-dot.tsx";
import type { RunRow, RunStateView } from "./run-list.tsx";
import type { SidebarAgent } from "./sidebar-agent.ts";

/** Agent 모양이 쓰는 session 한 줄. `useSessions()`의 항목에서 부르는 쪽이 옮긴다. */
export interface PanelSession {
  readonly id: string;
  readonly title: string;
  /** 이 session을 가진 agent의 `asg_…`. */
  readonly agent: string;
  /** 탭 줄과 같은 상태 점. 없으면 null이다. */
  readonly dot: TabDot | null;
  /** 이 창에 그 session의 탭이 열려 있다. 닫으면 Recent로 간다. */
  readonly open: boolean;
  /** 마지막으로 움직인 때(epoch ms). */
  readonly at: number;
}

/** 터미널 coding agent session 한 줄. 이 창의 탭에서 도는 것(live)이거나 main이 저장한 것(saved)이다. */
export interface PanelTerminal {
  /** live면 탭 key, saved면 harness와 session id. */
  readonly key: string;
  readonly harness: string;
  /** harness의 제품 이름. */
  readonly label: string;
  readonly title: string;
  readonly dot: TabDot | null;
  /** 마지막으로 움직인 때(epoch ms). */
  readonly at: number;
  /** 이 창에서 도는 탭. 누르면 그 탭을 고른다. */
  readonly live: { readonly tabKey: string } | null;
  /** 저장만 된 session. 누르면 그 폴더에서 새 터미널 탭을 연다. */
  readonly saved: {
    readonly folderRef: string;
    readonly externalSession: string;
    /** harness에 resume 규칙이 있어 이어 열 수 있다. */
    readonly resumable: boolean;
  } | null;
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

/** Current와 Recent의 한 줄. lophn session은 가진 agent의 avatar와 이름을 함께 든다. */
export type PanelItem = {
  /** 마지막으로 움직인 때(epoch ms). 섞어 늘어놓는 순서가 이 값이다. */
  readonly at: number;
  /** 열려 있는 lophn session이거나 이 창에서 도는 터미널 session이다. 아니면 Recent에 오른다. */
  readonly open: boolean;
} & (
  | {
      readonly kind: "session";
      readonly session: PanelSession;
      readonly agent: SidebarAgent;
    }
  | { readonly kind: "terminal"; readonly terminal: PanelTerminal }
);

export interface AgentPanelView {
  /** 받은 agent 목록 그대로(lophn이 첫 줄). */
  readonly agents: readonly SidebarAgent[];
  /** 열린 session. 비면 묶음이 없다. */
  readonly current: readonly PanelItem[];
  /** 새것부터 `RUN_LIMIT`개. 비면 묶음이 없다. */
  readonly runs: readonly RunRow[];
  /** 최근 7일 안에 움직인 session. 사람이 지운 줄은 그 시각보다 새로워지기 전까지 뺀다. */
  readonly recent: readonly PanelItem[];
}

const RUN_LIMIT = 5;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 사람이 Recent에서 지운 줄의 key → 지운 때(epoch ms). */
export type HiddenRecent = ReadonlyMap<string, number>;

function agentPanelOf(
  agents: readonly SidebarAgent[],
  sessions: readonly PanelSession[],
  terminals: readonly PanelTerminal[],
  runs: readonly PanelRun[],
  hidden: HiddenRecent,
  now: number,
): AgentPanelView {
  const names = new Map(agents.map((a) => [a.assignment, a]));
  const items: PanelItem[] = [
    ...sessions.flatMap((session): PanelItem[] => {
      const agent = names.get(session.agent);
      return agent === undefined
        ? []
        : [
            {
              kind: "session",
              at: session.at,
              open: session.open,
              session,
              agent,
            },
          ];
    }),
    ...terminals.map(
      (terminal): PanelItem => ({
        kind: "terminal",
        at: terminal.at,
        open: terminal.live !== null,
        terminal,
      }),
    ),
  ].sort((a, b) => b.at - a.at);
  return {
    agents,
    current: items.filter((item) => item.open),
    // job이 시간마다 run을 만들어도 sidebar가 자라지 않게 새것 몇 개만 보인다.
    runs: [...runs]
      .sort((a, b) => b.at - a.at)
      .flatMap((run) => {
        const agent = names.get(run.agent);
        return agent === undefined
          ? []
          : [
              {
                id: run.id,
                name: run.title ?? agent.name,
                via: run.title === null ? null : agent.name,
                profile: agent.profile,
                state: run.state,
                at: run.at,
                session: run.session,
              },
            ];
      })
      .slice(0, RUN_LIMIT),
    recent: items.filter((item) => {
      if (item.open) return false;
      const hiddenAt = hidden.get(
        item.kind === "session" ? item.session.id : item.terminal.key,
      );
      if (hiddenAt !== undefined && item.at <= hiddenAt) return false;
      // 시각을 모르는 줄은 7일 경계로 지우지 않는다.
      return item.at === 0 || now - item.at <= RECENT_WINDOW_MS;
    }),
  };
}

const NO_RUNS: readonly PanelRun[] = [];
const NO_HIDDEN: HiddenRecent = new Map();

export function useAgentPanel(
  agents: readonly SidebarAgent[],
  sessions: readonly PanelSession[],
  terminals: readonly PanelTerminal[],
  runs: readonly PanelRun[] = NO_RUNS,
  hidden: HiddenRecent = NO_HIDDEN,
): AgentPanelView {
  return useMemo(
    () => agentPanelOf(agents, sessions, terminals, runs, hidden, Date.now()),
    [agents, sessions, terminals, runs, hidden],
  );
}
