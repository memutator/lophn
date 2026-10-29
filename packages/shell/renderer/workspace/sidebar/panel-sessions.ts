// `useSessions()`의 session 상태를 sidebar의 Agent 모양과 Agent 탭의 상태 점이 읽는 값으로 옮긴다.
import { t } from "@lophn/wording";

import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import type { SidebarAgent } from "./sidebar-agent.ts";
import type { PanelRun, PanelSession } from "./use-agent-panel.ts";
import type { RunRecordView } from "./run-list.tsx";
import type { TabDot } from "../../parts/tab-strip/tab-strip.tsx";

// renderer session store의 agent를 읽는 한 곳. store는 agent id를 싣는다.
export function sessionAgentKey(entry: SessionEntry): string | null {
  return entry.agent;
}

function sessionAtProject(entry: SessionEntry, project: string): boolean {
  return entry.place?.kind === "project" && entry.place.id === project;
}

/**
 * 이 project place의 열린 lophn session 가운데 가장 최근 것.
 */
export function openedPlaceLophnSession(
  entries: readonly SessionEntry[],
  project: string,
): string | null {
  const found = entries.filter(
    (entry) =>
      entry.ended === null &&
      sessionAgentKey(entry) === "lophn" &&
      sessionAtProject(entry, project),
  );
  return found.length === 0 ? null : found[found.length - 1].session;
}

// session을 가진 agent를 sidebar의 agent 줄로 찾는다.
export function agentRow(
  entry: SessionEntry,
  agents: readonly SidebarAgent[],
  project: string,
): SidebarAgent | undefined {
  const key = sessionAgentKey(entry);
  if (key === null || !sessionAtProject(entry, project)) return undefined;
  return agents.find((row) => row.assignment === key);
}

/** 대화 source(`AgentTabSource.sessions()`)가 읽은 session의 제목과 마지막 활동 시각(epoch ms). */
export type KnownSessions = ReadonlyMap<
  string,
  { readonly title: string | null; readonly at: number }
>;

/**
 * sidebar의 lophn session 줄. `tabs`는 이 창에 열린 Agent 탭의 session id → 그 탭의 제목이다. 탭이 열린 session은
 * Current, 닫은 session은 Recent다. 제목은 탭 제목을 먼저 쓴다(탭 줄과 sidebar가 같은 이름을 보인다).
 */
export function panelSessions(
  entries: readonly SessionEntry[],
  agents: readonly SidebarAgent[],
  project: string,
  known: KnownSessions = new Map(),
  tabs: ReadonlyMap<string, string> = new Map(),
): PanelSession[] {
  return entries.flatMap((entry) => {
    const row = agentRow(entry, agents, project);
    if (row === undefined) return [];
    // session store는 제목과 시각을 싣지 않는다. 대화 source가 읽어 준 것이 있으면 그것을 쓴다.
    const read = known.get(entry.session);
    const tabTitle = tabs.get(entry.session);
    return [
      {
        id: entry.session,
        title:
          tabTitle ?? read?.title ?? t("conversation.label.session-untitled"),
        agent: row.assignment,
        dot: sessionDot(entries, entry.session),
        open: tabTitle !== undefined,
        at: read?.at ?? 0,
      },
    ];
  });
}

/** run이 연 session id 모음. sidebar는 이 session을 run 아래로 옮긴다. */
export function runOpenedSessions(
  records: readonly RunRecordView[],
): ReadonlySet<string> {
  return new Set(
    records.flatMap((record) =>
      record.session_opened && record.session !== null ? [record.session] : [],
    ),
  );
}

/** project sidebar의 run 줄. place로 거르는 일은 부르는 쪽이 한다. agent run 가운데 sidebar가 agent 줄을 찾는 것만 남긴다(tool run은 앱 공간 몫). */
export function panelRuns(
  records: readonly RunRecordView[],
  agents: readonly SidebarAgent[],
  project: string,
  sessions: readonly PanelSession[],
): PanelRun[] {
  return records.flatMap((record): PanelRun[] => {
    if (record.kind !== "agent" || !("agent" in record.target)) return [];
    const key = record.target.agent.agent;
    const row = agents.find((item) => item.assignment === key);
    if (row === undefined) return [];
    return [
      {
        id: record.id,
        agent: row.assignment,
        title: record.job?.title ?? null,
        state: record.state,
        at: Date.parse(record.created_at),
        session: record.session_opened
          ? (sessions.find((item) => item.id === record.session) ?? null)
          : null,
      },
    ];
  });
}

/** Agent 탭 이름 뒤의 상태 점. 도는 중이나 기다리는 중이 먼저고, 아니면 못 본 turn 끝이 finished다. */
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
      : entry.unseen !== null
        ? "finished"
        : null;
}
