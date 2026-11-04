// 터미널 coding agent session을 공통 agent session 모양으로 옮긴다. 상태는 main이 hook으로 알려 준 것이다.
import type { TerminalAgent } from "../../../ipc/terminal.ts";
import type { TabDot } from "../tab-state-dot/tab-state-dot.tsx";
import { harnessVendorOf } from "../vendor-icon/vendor-icon.tsx";
import {
  activityDot,
  type AgentFace,
  type AgentSessionActivity,
} from "./agent-session.tsx";

// 터미널은 닫으면 session이 줄에서 빠져 ended가 없다.
export function codingActivity(agent: TerminalAgent): AgentSessionActivity {
  return { state: agent.state, unseen: agent.unseen, ended: false };
}

export const codingDot = (agent: TerminalAgent): TabDot | null =>
  activityDot(codingActivity(agent));

export const codingFace = (
  harness: string,
): Extract<AgentFace, { kind: "coding" }> => ({
  kind: "coding",
  vendor: harnessVendorOf(harness),
});
