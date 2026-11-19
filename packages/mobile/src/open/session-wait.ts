// Pure decision logic for opening a session URL / notification target on cold or warm start.
// Kept free of React / Expo imports so Node unit tests exercise it directly.
import type { ComputerStatus } from "../../../remote-client/mod.ts";
import type { ConversationTarget } from "../data/hooks.tsx";

export type SessionWaitAction =
  | { readonly kind: "open"; readonly target: ConversationTarget }
  | { readonly kind: "wait" }
  | { readonly kind: "timeout" };

/**
 * Decides what `OpenTapped` should do for a `kind: "session"` target once the host computer is selected:
 * - If the session is already in the list, open it immediately.
 * - While the target computer is still connecting, or connected before its first session snapshot has settled, wait
 *   without starting the 8-second fallback timer so cold start does not drop straight to Inbox.
 * - Once the first session list has settled (or the computer is offline / revoked / needs update), start the 8-second
 *   fallback timer to open Inbox if the session never appears.
 */
export function sessionWaitAction(input: {
  readonly target: ConversationTarget | null;
  readonly status: ComputerStatus;
  readonly sessionsSettled: boolean;
}): SessionWaitAction {
  if (input.target !== null) return { kind: "open", target: input.target };
  if (input.status === "connecting") return { kind: "wait" };
  if (input.status === "connected" && !input.sessionsSettled) {
    return { kind: "wait" };
  }
  return { kind: "timeout" };
}
