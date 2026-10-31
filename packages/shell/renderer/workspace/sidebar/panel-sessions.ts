// `useSessions()`의 session 상태를 project place의 agent 줄과 상태 점이 읽는 값으로 옮긴다.
import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import type { SidebarAgent } from "./sidebar-agent.ts";
import type { TabDot } from "../../parts/tab-state-dot/tab-state-dot.tsx";

// renderer session store의 agent를 읽는 한 곳. store는 agent id를 싣는다.
export function sessionAgentKey(entry: SessionEntry): string | null {
  return entry.agent;
}

// project가 null이면 Home(place 없음)이다.
function sessionAtProject(entry: SessionEntry, project: string | null): boolean {
  return project === null
    ? entry.place === null
    : entry.place?.kind === "project" && entry.place.id === project;
}

/**
 * 이 project place의 열린 lophn session 가운데 가장 최근 것.
 */
export function openedPlaceLophnSession(
  entries: readonly SessionEntry[],
  project: string | null,
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
  project: string | null,
): SidebarAgent | undefined {
  const key = sessionAgentKey(entry);
  if (key === null || !sessionAtProject(entry, project)) return undefined;
  return agents.find((row) => row.assignment === key);
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
