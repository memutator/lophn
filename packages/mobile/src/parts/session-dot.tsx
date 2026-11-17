import { Dot, type DotTone } from "@lophn/ui-native";
import type { SessionStatus } from "../data/mod.ts";

/**
 * A session's state as its dot, the desktop's colors in the sidebar and every list: waiting yellow, working ink that
 * breathes, a turn ended and not seen green, ended gray (the kit's toneless dot). Idle has no dot.
 */
export const SESSION_DOT: Record<SessionStatus, DotTone | undefined> = {
  waiting: "warning",
  working: "working",
  finished: "good",
  ended: undefined,
  idle: undefined,
};

/** The dot at the end of a session's list row; nothing when idle. */
export function SessionDot({ status }: { status: SessionStatus }) {
  return status === "idle" ? null : <Dot tone={SESSION_DOT[status]} />;
}
