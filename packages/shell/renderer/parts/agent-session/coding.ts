// 터미널 coding agent session을 공통 agent session 모양으로 옮긴다. 상태는 main이 hook으로 알려 준 것이고, 못 본 끝은
// core의 `unseen`(`term:<탭>`)을 탭 store가 더한 것이다.
import type { TabAgent } from "../../terminal/store.ts";
import { harnessVendorOf } from "../vendor-icon/vendor-icon.tsx";
import {
  activityDot,
  type AgentSessionActivity,
  type SessionDot,
} from "./activity.ts";
import type { AgentFace } from "./agent-session.tsx";

// 터미널은 닫으면 session이 줄에서 빠져 ended가 없다.
export function codingActivity(agent: TabAgent): AgentSessionActivity {
  return { state: agent.state, unseen: agent.unseen, ended: false };
}

export const codingDot = (agent: TabAgent): SessionDot | null =>
  activityDot(codingActivity(agent));

export const codingFace = (
  harness: string,
): Extract<AgentFace, { kind: "coding" }> => ({
  kind: "coding",
  vendor: harnessVendorOf(harness),
});
