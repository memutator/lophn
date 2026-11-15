import type { DotTone } from "@lophn/ui-native";
import type { SessionStatus } from "../data/mod.ts";

/** A session's state as its dot, the same in the sidebar and every list: waiting yellow, working green, failed red. */
export const SESSION_DOT: Record<SessionStatus, DotTone | undefined> = {
  waiting: "warning",
  working: "good",
  failed: "critical",
  idle: undefined,
};
