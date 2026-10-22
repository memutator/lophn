// `useSessions()`의 session 상태를 sidebar의 Agent 모양과 Agent 탭의 상태 점이 읽는 값으로 옮긴다.
import { t } from "@lophn/wording";

import type { CallAgent } from "../../../../protocol/lophn-agent/calls.ts";
import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import type { SidebarAgent, SidebarAgentRole } from "./sidebar-agent.ts";
import type { PanelRun, PanelSession } from "./use-agent-panel.ts";
import type { RunRecordView } from "./run-list.tsx";
import type { TabDot } from "../../parts/tab-strip/tab-strip.tsx";

/**
 * role로 agent 줄을 찾는다. Operator는 여럿이라 이 함수로 찾지 않는다.
 */
export function agentByRole(
  agents: readonly SidebarAgent[],
  role: Exclude<SidebarAgentRole, "operator">,
): SidebarAgent | undefined {
  return agents.find((row) => row.role === role);
}

/**
 * 이 project의 열린 Project Manager session 가운데 가장 최근 것.
 */
export function openedProjectManagerSession(
  entries: readonly SessionEntry[],
  project: string,
): string | null {
  const found = entries.filter((entry) =>
    entry.ended === null && entry.agent?.role === "project_manager" &&
    entry.agent.project === project
  );
  return found.length === 0 ? null : found[found.length - 1].session;
}

// agent ref를 sidebar의 agent 줄로 찾는다. 이 project에 놓인 agent와 lophn만 줄이 있다.
// session과 run이 같은 규칙을 쓴다.
function agentRowOf(
  agent: CallAgent | null,
  agents: readonly SidebarAgent[],
  project: string,
): SidebarAgent | undefined {
  if (agent === null) return undefined;
  if (agent.role === "lophn") return agentByRole(agents, "lophn");
  if (agent.role === "project_manager") {
    return agent.project === project
      ? agentByRole(agents, "project_manager")
      : undefined;
  }
  if (agent.role === "operator") {
    return agents.find((row) =>
      row.role === "operator" && row.assignment === agent.agent
    );
  }
  return undefined;
}

// session을 가진 agent를 sidebar의 agent 줄로 찾는다.
export function agentRow(
  entry: SessionEntry,
  agents: readonly SidebarAgent[],
  project: string,
): SidebarAgent | undefined {
  return agentRowOf(entry.agent, agents, project);
}

/** 대화 source(`AgentTabSource.sessions()`)가 읽은 session의 제목과 마지막 활동 시각(epoch ms). */
export type KnownSessions = ReadonlyMap<
  string,
  { readonly title: string | null; readonly at: number }
>;

export function panelSessions(
  entries: readonly SessionEntry[],
  agents: readonly SidebarAgent[],
  project: string,
  known: KnownSessions = new Map(),
): PanelSession[] {
  return entries.flatMap((entry) => {
    const row = agentRow(entry, agents, project);
    if (row === undefined) return [];
    // session store는 제목과 시각을 싣지 않는다. 대화 source가 읽어 준 것이 있으면 그것을 쓴다.
    const read = known.get(entry.session);
    return [{
      id: entry.session,
      title: read?.title ?? t("conversation.label.session-untitled"),
      agent: row.assignment,
      status: entry.state === "waiting"
        ? "waiting"
        : entry.state === "running"
        ? "working"
        : "idle",
      open: entry.ended === null,
      at: read?.at ?? 0,
    }];
  });
}

/** run이 연 session id 모음. sidebar는 이 session을 run 아래로 옮긴다. */
export function runOpenedSessions(
  records: readonly RunRecordView[],
): ReadonlySet<string> {
  return new Set(
    records.flatMap((record) =>
      record.session_opened && record.session !== null ? [record.session] : []
    ),
  );
}

/** project sidebar의 run 줄. agent run 가운데 sidebar가 agent 줄을 찾는 것만 남긴다(tool run은 앱 공간 몫). */
export function panelRuns(
  records: readonly RunRecordView[],
  agents: readonly SidebarAgent[],
  project: string,
  sessions: readonly PanelSession[],
): PanelRun[] {
  return records.flatMap((record): PanelRun[] => {
    if (record.kind !== "agent" || !("agent" in record.target)) return [];
    const row = agentRowOf(record.target.agent, agents, project);
    if (row === undefined) return [];
    return [{
      id: record.id,
      agent: row.assignment,
      state: record.state,
      at: Date.parse(record.created_at),
      session: record.session_opened
        ? sessions.find((item) => item.id === record.session) ?? null
        : null,
    }];
  });
}

/** Agent 탭 이름 뒤의 상태 점. */
export function sessionDot(
  entries: readonly SessionEntry[],
  session: string | null,
): TabDot | null {
  if (session === null) return null;
  const entry = entries.find((item) => item.session === session);
  if (entry === undefined) return null;
  if (entry.ended !== null) return "ended";
  return entry.state === "waiting"
    ? "waiting"
    : entry.state === "running"
    ? "working"
    : null;
}
