// `useSessions()`의 session을 workspace의 agent 줄이 읽는 값으로 옮긴다. 상태 점은 parts/agent-session/lophn.ts다.
import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import type { WorkspaceRef } from "../../shell/desk-model.ts";
import type { SidebarAgent } from "./sidebar-agent.ts";

// renderer session store의 agent를 읽는 한 곳. store는 agent id를 싣는다.
export function sessionAgentKey(entry: SessionEntry): string | null {
  return entry.agent;
}

// Home은 workspace가 없는 session이다.
function sessionAtWorkspace(
  entry: SessionEntry,
  workspace: WorkspaceRef,
): boolean {
  return workspace.kind === "home"
    ? entry.workspace === null
    : entry.workspace?.kind === workspace.kind &&
        entry.workspace.id === workspace.id;
}

/**
 * 이 workspace의 열린 lophn session 가운데 가장 최근 것.
 */
export function openedWorkspaceLophnSession(
  entries: readonly SessionEntry[],
  workspace: WorkspaceRef,
): string | null {
  const found = entries.filter(
    (entry) =>
      entry.ended === null &&
      sessionAgentKey(entry) === "lophn" &&
      sessionAtWorkspace(entry, workspace),
  );
  return found.length === 0 ? null : found[found.length - 1].session;
}

// session을 가진 agent를 sidebar의 agent 줄로 찾는다.
export function agentRow(
  entry: SessionEntry,
  agents: readonly SidebarAgent[],
  workspace: WorkspaceRef,
): SidebarAgent | undefined {
  const key = sessionAgentKey(entry);
  if (key === null || !sessionAtWorkspace(entry, workspace)) return undefined;
  return agents.find((row) => row.assignment === key);
}
