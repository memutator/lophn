// Where the phone opens when something outside the app points at it: a notification tap, a widget tap, a home screen
// shortcut. React-free so Node tests drive it. A notification carries it as `data` (core's `PushMessage.data`: the
// computer's public key and one of session, app or inbox); everything else carries it as a `lophn://open?...` URL.

export type OpenTarget =
  | { readonly kind: "session"; readonly host: string; readonly session: string }
  | {
      readonly kind: "app";
      readonly host: string;
      readonly app: string;
      /** Which screen of the app; absent opens the app's own default. */
      readonly screen?: string;
    }
  | { readonly kind: "inbox"; readonly host: string }
  /**
   * A placed widget that is bound to nothing (the launcher placed it, or the person tapped "Tap to choose"): "Choose a
   * widget" for it. `configure`: the launcher's configure step waits for the answer. It names no computer.
   */
  | {
      readonly kind: "widget_bind";
      readonly widget: number;
      readonly configure?: true;
    };

const PREFIX = "lophn://open?";
const WIDGET_PREFIX = "lophn://widget/bind?";

const text = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

function fromUrl(url: string, prefix = PREFIX): Record<string, string> | null {
  if (!url.startsWith(prefix)) return null;
  const fields: Record<string, string> = {};
  try {
    for (const pair of url.slice(prefix.length).split("&")) {
      const at = pair.indexOf("=");
      if (at < 0) continue;
      fields[decodeURIComponent(pair.slice(0, at))] = decodeURIComponent(
        pair.slice(at + 1),
      );
    }
  } catch {
    return null;
  }
  return fields;
}

/**
 * Reads a notification's `data` object or a URL. Both come from outside (the internet, another app, a link someone
 * typed), so anything that is not the shape lophn makes, or names a computer this phone is not paired with, gives null
 * and nothing opens.
 */
export function parseOpenTarget(
  value: unknown,
  pairedHosts: ReadonlySet<string>,
): OpenTarget | null {
  if (typeof value === "string" && value.startsWith(WIDGET_PREFIX)) {
    const { id, from } = fromUrl(value, WIDGET_PREFIX) ?? {};
    if (id === undefined || !/^[1-9][0-9]{0,9}$/.test(id)) return null;
    return from === "configure"
      ? { kind: "widget_bind", widget: Number(id), configure: true }
      : { kind: "widget_bind", widget: Number(id) };
  }
  const fields = typeof value === "string" ? fromUrl(value) : value;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return null;
  }
  const { host, kind, session, app, screen } = fields as Record<string, unknown>;
  if (!text(host) || !pairedHosts.has(host)) return null;
  switch (kind) {
    case "inbox":
      return { kind, host };
    case "session":
      return text(session) ? { kind, host, session } : null;
    case "app":
      if (!text(app)) return null;
      if (screen === undefined) return { kind, host, app };
      return text(screen) ? { kind, host, app, screen } : null;
    default:
      return null;
  }
}

export function openUrl(target: OpenTarget): string {
  if (target.kind === "widget_bind") {
    return `${WIDGET_PREFIX}id=${target.widget}${target.configure ? "&from=configure" : ""}`;
  }
  const fields: [string, string][] = [
    ["host", target.host],
    ["kind", target.kind],
  ];
  if (target.kind === "session") fields.push(["session", target.session]);
  if (target.kind === "app") {
    fields.push(["app", target.app]);
    if (target.screen !== undefined) fields.push(["screen", target.screen]);
  }
  return (
    PREFIX + fields.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
  );
}
