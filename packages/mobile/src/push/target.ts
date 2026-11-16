// A terminal tab is not a conversation the phone can open; its waiting shows in the Inbox. Only a notification can point
// at one (core pushes about terminal tabs), so the rule is not part of what `parseOpenTarget` accepts.
/** A notification's `data`, with the terminal session rule applied. Not validated: `parseOpenTarget` does that. */
export function notificationData(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const { host, kind, session } = data as Record<string, unknown>;
  return kind === "session" && typeof session === "string" && session.startsWith("term:")
    ? { host, kind: "inbox" }
    : data;
}
