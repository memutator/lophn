// Where a notification tap goes. React-free so Node tests drive it.
// The `data` of a push is what core sends (`PushMessage.data`): the computer's public key and one of session, app or inbox.

export type NotificationTarget =
  | { readonly kind: "session"; readonly host: string; readonly session: string }
  | { readonly kind: "app"; readonly host: string; readonly app: string }
  | { readonly kind: "inbox"; readonly host: string };

const text = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/**
 * Reads a notification's `data`. It came over the internet (or from another app's notification), so anything that is not
 * the shape lophn sends gives null and the tap opens nothing.
 */
export function parseNotificationData(data: unknown): NotificationTarget | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const { host, kind, session, app } = data as Record<string, unknown>;
  if (!text(host)) return null;
  switch (kind) {
    case "inbox":
      return { kind, host };
    case "app":
      return text(app) ? { kind, host, app } : null;
    case "session":
      if (!text(session)) return null;
      // A terminal tab is not a conversation the phone can open; its waiting shows in the Inbox.
      return session.startsWith("term:")
        ? { kind: "inbox", host }
        : { kind, host, session };
    default:
      return null;
  }
}
