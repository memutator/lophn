// `useSessions()`의 session 상태를 sidebar의 Agent 모양과 Agent 탭의 상태 점이 읽는 값으로 옮긴다.
import type { TabDot } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import type { SidebarAgent, SidebarAgentRole } from "./sidebar-agent.ts";
import type { PanelSession } from "./use-agent-panel.ts";

/**
 * role로 agent 줄을 찾는다. Project Manager는 agent 목록 계약이 아직 돌려주는 옛 이름도 같은 줄로 본다.
 * Operator는 여럿이라 이 함수로 찾지 않는다.
 */
export function agentByRole(
  agents: readonly SidebarAgent[],
  role: Exclude<SidebarAgentRole, "operator" | "context_engineer">,
): SidebarAgent | undefined {
  return agents.find((row) =>
    row.role === role ||
    (role === "project_manager" && row.role === "context_engineer")
  );
}

// session을 가진 agent를 sidebar의 agent 줄로 찾는다. 이 project에 놓인 agent와 lophn만 줄이 있다.
function agentRow(
  entry: SessionEntry,
  agents: readonly SidebarAgent[],
  project: string,
): SidebarAgent | undefined {
  const agent = entry.agent;
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

export function panelSessions(
  entries: readonly SessionEntry[],
  agents: readonly SidebarAgent[],
  project: string,
): PanelSession[] {
  return entries.flatMap((entry) => {
    const row = agentRow(entry, agents, project);
    if (row === undefined) return [];
    return [{
      id: entry.session,
      // session store는 제목과 시각을 싣지 않는다. 제목은 대화가 읽은 뒤에 알 수 있다.
      title: t("conversation.label.session-untitled"),
      agent: row.assignment,
      status: entry.state === "waiting"
        ? "waiting"
        : entry.state === "running"
        ? "working"
        : "idle",
      open: entry.ended === null,
      at: 0,
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
