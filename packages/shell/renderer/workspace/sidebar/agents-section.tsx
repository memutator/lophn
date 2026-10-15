// screens-agents의 `sidebar-agents.ts`가 아직 이 경로에서 SidebarAgent를 import한다. 그쪽이 `sidebar-agent.ts`로
// 옮기면 이 file을 지운다.
export type { SidebarAgent, SidebarAgentRole } from "./sidebar-agent.ts";
