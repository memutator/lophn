// 그 project place의 lophn session을 연다. 이미 연 session이 있으면 그 session의 Agent 탭을, 없으면 새 session 탭을 연다.
import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import { LOPHN_AGENT_ID } from "../../../../protocol/lophn-agent/places.ts";
import { openAgent } from "../kinds/agent.tsx";
import type { TabHost } from "../kinds/host.ts";
import { openedProjectManagerSession } from "../sidebar/panel-sessions.ts";
import type { SidebarAgent } from "../sidebar/sidebar-agent.ts";

/** 열 때의 최신 값. 값이 아니라 읽는 함수로 받아 그때 작업대를 본다. */
interface ProjectLophnEnv {
  readonly project: string;
  readonly host: () => TabHost;
  readonly sessions: () => readonly SessionEntry[];
  readonly agents: () => readonly SidebarAgent[];
}

/** 그 project place의 lophn session을 열 수 있으면 true. */
export function openProjectLophn(env: ProjectLophnEnv): boolean {
  const row = env.agents().find((item) => item.assignment === LOPHN_AGENT_ID);
  if (row === undefined || env.host().agentView === null) return false;
  openAgent(env.host(), {
    agent: row.assignment,
    name: row.name,
    session: openedProjectManagerSession(env.sessions(), env.project),
  });
  return true;
}
