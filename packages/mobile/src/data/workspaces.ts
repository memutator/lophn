// The phone's workspace list: Home, every project, every app, and under each its sessions. Session state comes from the
// desktop sessions store (snapshot and events), titles and times from `sessions/list`, faces from `agents/read`.
//
// The desktop sidebar keeps a session in its workspace while a tab shows it (left-sidebar-workspaces.ts). The phone has no
// tabs, so a session stays in the list while it works or waits, or for a day after it last moved; older ones (up to 7 days)
// go under Recent. Ported from the web phone list (remote/session-list.tsx), which goes away with the web phone screen.
import type { AgentFace } from "../../../shell/renderer/conversation/agent-tab-source.ts";
import type { SessionEntry } from "../../../shell/renderer/desktop/connection/events/sessions-store.ts";
import type { WaitingEntry } from "../../../shell/renderer/desktop/connection/events/waiting-store.ts";
import type { CharacterProfile } from "../../../protocol/lophn-agent/agent-values.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import { codingFaceOf } from "../../../shell/renderer/workspace/agents/coding-face.ts";

export type SessionStatus = "waiting" | "working" | "idle" | "failed";

/** Who runs a session: a lophn agent's character, or a coding agent's product icon. Same rule as the conversation header. */
export interface Who {
  readonly name: string;
  readonly profile: AgentFace["profile"];
}

/** What a waiting session waits for: a permission request, a question, or another Inbox item. */
export type WaitingFor = "approval" | "answer" | "other";

export interface SessionRow {
  readonly id: string;
  /** null before the first message gives the session a title. */
  readonly title: string | null;
  readonly agent: AgentId | null;
  readonly workspace: Workspace | null;
  readonly who: Who | null;
  readonly status: SessionStatus;
  /** Set when status is waiting. */
  readonly waitingFor: WaitingFor | null;
  /** Last activity in epoch ms; 0 when not known yet. */
  readonly at: number;
  /** Inbox items this session waits on. */
  readonly waiting: number;
}

export type WorkspaceIcon =
  | { readonly kind: "home" }
  | { readonly kind: "project" }
  | { readonly kind: "app"; readonly letter: string; readonly tone: number };

export interface SessionGroup {
  /** Desk name (the desktop sidebar's worktree group). null when the computer does not say. */
  readonly label: string | null;
  readonly rows: readonly SessionRow[];
}

export interface WorkspaceView {
  /** `home`, or the project or app id. */
  readonly key: string;
  readonly kind: "home" | "project" | "app";
  readonly workspace: Workspace | null;
  /** Project title or app name; null for Home, whose name the screen says. */
  readonly name: string | null;
  readonly icon: WorkspaceIcon;
  readonly groups: readonly SessionGroup[];
  readonly recent: readonly SessionRow[];
}

/** What the reads found: session id → title and last activity, agent id → name and profile. */
export interface Known {
  readonly titles: ReadonlyMap<string, { title: string | null; at: number }>;
  readonly agents: ReadonlyMap<
    string,
    { name: string; profile: CharacterProfile | { kind: "image" } }
  >;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_MS = 7 * DAY_MS;
// App marks take one of a few tones by id, so an app keeps its colour everywhere.
const APP_TONES = 6;

/** The color of an app's mark: the same everywhere the app is drawn. */
export function toneOf(id: string): number {
  let sum = 0;
  for (const char of id) sum = (sum + char.charCodeAt(0)) % APP_TONES;
  return sum;
}

/** An app's mark: its name's first letter on a tone picked from its id. */
export function appIcon(id: string, name: string): WorkspaceIcon {
  return { kind: "app", letter: name.slice(0, 1).toUpperCase(), tone: toneOf(id) };
}

export function whoOf(agent: AgentId, known: Known): Who | null {
  const read = known.agents.get(agent);
  if (read === undefined) return null;
  return {
    name: read.name,
    profile:
      codingFaceOf(agent) ??
      (read.profile.kind === "character"
        ? read.profile
        : { kind: "initial", text: read.name.slice(0, 1) }),
  };
}

function rowOf(
  entry: SessionEntry,
  known: Known,
  waiting: readonly WaitingEntry[],
): SessionRow {
  const mine = waiting.filter((one) => one.session === entry.session);
  const title = known.titles.get(entry.session);
  // An Inbox item counts even before the session state catches up with it.
  const status: SessionStatus =
    mine.length > 0 || entry.state === "waiting"
      ? "waiting"
      : entry.state === "running"
        ? "working"
        : "idle";
  const waitingFor: WaitingFor | null =
    status !== "waiting"
      ? null
      : mine[0]?.kind === "question"
        ? "answer"
        : mine[0]?.kind === "permission"
          ? "approval"
          : "other";
  return {
    id: entry.session,
    title: title?.title ?? null,
    agent: entry.agent,
    workspace: entry.workspace,
    who: entry.agent === null ? null : whoOf(entry.agent, known),
    status,
    waitingFor,
    at: title?.at ?? 0,
    waiting: mine.length,
  };
}

const newest = (a: SessionRow, b: SessionRow) => b.at - a.at;

export function workspacesOf(input: {
  readonly now: number;
  readonly sessions: readonly SessionEntry[];
  readonly waiting: readonly WaitingEntry[];
  readonly projects: readonly { readonly id: string; readonly title: string }[];
  readonly apps: readonly { readonly id: string; readonly name: string }[];
  readonly known: Known;
  readonly deskOf?: (session: string) => string | null;
}): WorkspaceView[] {
  const current = new Map<string, Map<string | null, SessionRow[]>>();
  const recent = new Map<string, SessionRow[]>();
  for (const entry of input.sessions) {
    if (entry.ended !== null || entry.archived) continue;
    const key = entry.workspace?.id ?? "home";
    const row = rowOf(entry, input.known, input.waiting);
    const age = input.now - row.at;
    if (row.status !== "idle" || row.at === 0 || age <= DAY_MS) {
      const desk = input.deskOf?.(row.id) ?? null;
      const groups = current.get(key) ?? new Map<string | null, SessionRow[]>();
      groups.set(desk, [...(groups.get(desk) ?? []), row]);
      current.set(key, groups);
    } else if (age <= RECENT_MS) {
      recent.set(key, [...(recent.get(key) ?? []), row]);
    }
  }
  const view = (
    key: string,
    kind: WorkspaceView["kind"],
    workspace: Workspace | null,
    name: string | null,
    icon: WorkspaceIcon,
  ): WorkspaceView => ({
    key,
    kind,
    workspace,
    name,
    icon,
    // The group without a desk and Main come first, the others by name.
    groups: [...(current.get(key) ?? new Map<string | null, SessionRow[]>())]
      .sort(([a], [b]) =>
        a === b
          ? 0
          : a === null || a === "Main"
            ? -1
            : b === null || b === "Main"
              ? 1
              : a.localeCompare(b),
      )
      .map(([label, rows]) => ({ label, rows: rows.sort(newest) })),
    recent: (recent.get(key) ?? []).sort(newest),
  });
  return [
    view("home", "home", null, null, { kind: "home" }),
    ...input.projects.map((project) =>
      view(
        project.id,
        "project",
        { kind: "project", id: project.id } as Workspace,
        project.title,
        { kind: "project" },
      ),
    ),
    ...input.apps.map((app) =>
      view(app.id, "app", { kind: "app", id: app.id } as Workspace, app.name, appIcon(app.id, app.name)),
    ),
  ];
}

/** A session's row and the workspace it is listed in, or undefined when the list does not have it. */
export function sessionIn(
  workspaces: readonly WorkspaceView[],
  session: string | null,
): { row: SessionRow; workspace: WorkspaceView } | undefined {
  for (const workspace of workspaces) {
    const row = [
      ...workspace.groups.flatMap((group) => group.rows),
      ...workspace.recent,
    ].find((one) => one.id === session);
    if (row !== undefined) return { row, workspace };
  }
  return undefined;
}
