// lophn agent session을 공통 agent session 모양으로 옮긴다. 상태는 renderer session store(`useSessions()`)의 것이다.
import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import type { TabDot } from "../tab-state-dot/tab-state-dot.tsx";
import { activityDot, type AgentSessionActivity } from "./agent-session.tsx";

export function lophnActivity(entry: SessionEntry): AgentSessionActivity {
  return {
    state: entry.state,
    unseen: entry.unseen !== null,
    ended: entry.ended !== null,
  };
}

export function lophnSessionDot(
  entries: readonly SessionEntry[],
  session: string | null,
): TabDot | null {
  const entry =
    session === null
      ? undefined
      : entries.find((item) => item.session === session);
  return entry === undefined ? null : activityDot(lophnActivity(entry));
}
