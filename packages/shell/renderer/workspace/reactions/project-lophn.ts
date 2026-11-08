// 그 workspace(project, 앱, Home)의 lophn session을 연다. 이미 연 session이 있으면 그 session의 Agent 탭을, 없으면 새 session 탭을 연다.
import type { WorkspaceRef } from "../../shell/desk-model.ts";
import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import { lophnIdAt } from "../agents/agent-key.ts";
import { openAgent } from "../kinds/agent.tsx";
import type { TabHost } from "../kinds/host.ts";
import { openedWorkspaceLophnSession } from "../sidebar/panel-sessions.ts";
import type { SidebarAgent } from "../sidebar/sidebar-agent.ts";

/** 열 때의 최신 값. 값이 아니라 읽는 함수로 받아 그때 작업대를 본다. */
interface ProjectLophnEnv {
  readonly workspace: WorkspaceRef;
  readonly host: () => TabHost;
  readonly sessions: () => readonly SessionEntry[];
  readonly agents: () => readonly SidebarAgent[];
}

/** 그 workspace의 lophn session을 열 수 있으면 true. */
export function openProjectLophn(env: ProjectLophnEnv): boolean {
  const wanted = lophnIdAt(env.workspace);
  const row = env.agents().find((item) => item.assignment === wanted);
  if (row === undefined || env.host().agentView === null) return false;
  openAgent(env.host(), {
    agent: row.assignment,
    name: row.name,
    session: openedWorkspaceLophnSession(env.sessions(), env.workspace),
  });
  return true;
}
