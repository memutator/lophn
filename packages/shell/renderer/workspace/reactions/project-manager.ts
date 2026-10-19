// 계약 위반 toast를 누르면 그 project의 Project Manager session으로 간다. reaction이 이미 연 session이 있으면
// 그 session의 Agent 탭을, 없으면 새 session 탭을 연다. 위반 내용은 붙이지 않는다. PM이 직접 읽는다.
import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import { openAgent } from "../kinds/agent.tsx";
import type { TabHost } from "../kinds/host.ts";
import {
  agentByRole,
  openedProjectManagerSession,
} from "../sidebar/panel-sessions.ts";
import type { SidebarAgent } from "../sidebar/sidebar-agent.ts";

/** 열 때의 최신 값. 값이 아니라 읽는 함수로 받아 그때 작업대를 본다. */
interface ProjectManagerEnv {
  readonly project: string;
  readonly host: () => TabHost;
  readonly sessions: () => readonly SessionEntry[];
  readonly agents: () => readonly SidebarAgent[];
}

/** Project Manager를 열 수 있으면 true. */
export function openProjectManager(env: ProjectManagerEnv): boolean {
  const row = agentByRole(env.agents(), "project_manager");
  if (row === undefined || env.host().agentView === null) return false;
  openAgent(env.host(), {
    agent: row.assignment,
    name: row.name,
    session: openedProjectManagerSession(env.sessions(), env.project),
  });
  return true;
}
