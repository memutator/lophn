// The phone's workspace list: Home, every project, every app, and under each its sessions. Session state comes from the
// desktop sessions store (snapshot and events), titles and times from `sessions/list`, faces from `agents/read`.
//
// The rules are the desktop sidebar's (shell parts/agent-session/activity.ts) without tabs: a session is in the list while
// it works, waits, or ended a turn the person has not seen; the rest (ended ones too) go under Recent for 7 days. The list
// keeps the order sessions were made in, so a row stays where it is while its state changes.
import type { AgentFace } from "../../../shell/renderer/conversation/agent-tab-source.ts";
import type { SessionEntry } from "../../../shell/renderer/desktop/connection/events/sessions-store.ts";
import type { WaitingEntry } from "../../../shell/renderer/desktop/connection/events/waiting-store.ts";
import type { CharacterAvatar } from "../../../protocol/lophn-agent/agent-values.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import {
  activityDot,
  byCreated,
  byNewest,
  sessionPlace,
} from "../../../shell/renderer/parts/agent-session/activity.ts";
import { lophnActivity } from "../../../shell/renderer/parts/agent-session/lophn.ts";
import { codingFaceOf } from "../../../shell/renderer/workspace/agents/coding-face.ts";
import type { SavedLists } from "./saved.ts";

/** The desktop's state dot (`activityDot`), idle where it has none. */
export type SessionStatus = "waiting" | "working" | "finished" | "ended" | "idle";

/** Who runs a session: a lophn agent's character, or a coding agent's product icon. Same rule as the conversation header. */
export interface Who {
  readonly name: string;
  readonly avatar: AgentFace["avatar"];
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

/** A project or an app carries its id: the mark draws the picture the phone keeps for it, if any. */
export type WorkspaceIcon =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly id: string }
  | {
      readonly kind: "app";
      readonly id: string;
      readonly letter: string;
      readonly tone: number;
    };

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

/** What the reads found: session id → title and last activity, agent id → name and avatar. */
export interface Known {
  readonly titles: ReadonlyMap<string, { title: string | null; at: number }>;
  readonly agents: ReadonlyMap<
    string,
    { name: string; avatar: CharacterAvatar | { kind: "image" } }
  >;
}

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
  return { kind: "app", id, letter: name.slice(0, 1).toUpperCase(), tone: toneOf(id) };
}

export function whoOf(agent: AgentId, known: Known): Who | null {
  const read = known.agents.get(agent);
  if (read === undefined) return null;
  return {
    name: read.name,
    avatar:
      codingFaceOf(agent) ??
      (read.avatar.kind === "character"
        ? read.avatar
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
  const status: SessionStatus = activityDot(lophnActivity(entry)) ?? "idle";
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
    if (entry.archived) continue;
    const key = entry.workspace?.id ?? "home";
    const row = rowOf(entry, input.known, input.waiting);
    const place = sessionPlace({
      dot: row.status === "idle" ? null : row.status,
      open: false,
      at: row.at,
      now: input.now,
    });
    if (place === "current") {
      const desk = input.deskOf?.(row.id) ?? null;
      const groups = current.get(key) ?? new Map<string | null, SessionRow[]>();
      groups.set(desk, [...(groups.get(desk) ?? []), row]);
      current.set(key, groups);
    } else if (place === "recent") {
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
      .map(([label, rows]) => ({
        label,
        rows: rows.sort((a, b) => byCreated(a.id, b.id)),
      })),
    recent: (recent.get(key) ?? []).sort(byNewest),
  });
  return [
    view("home", "home", null, null, { kind: "home" }),
    ...input.projects.map((project) =>
      view(
        project.id,
        "project",
        { kind: "project", id: project.id } as Workspace,
        project.title,
        { kind: "project", id: project.id },
      ),
    ),
    ...input.apps.map((app) =>
      view(app.id, "app", { kind: "app", id: app.id } as Workspace, app.name, appIcon(app.id, app.name)),
    ),
  ];
}

/**
 * The workspaces with the kept apps and projects they do not list. Only while the computer is away or nothing but Home is
 * listed yet: once the computer answers, its own lists are the truth (an app it dropped is gone).
 */
export function withSavedLists(
  workspaces: readonly WorkspaceView[],
  lists: SavedLists | null,
  online: boolean,
): readonly WorkspaceView[] {
  if (lists === null) return workspaces;
  if (online && workspaces.some((one) => one.kind !== "home")) return workspaces;
  const known = new Set(workspaces.map((one) => one.key));
  const blank = (
    kind: "project" | "app",
    id: string,
    name: string,
  ): WorkspaceView => ({
    key: id,
    kind,
    workspace: { kind, id } as Workspace,
    name,
    icon: kind === "app" ? appIcon(id, name) : { kind: "project", id },
    groups: [],
    recent: [],
  });
  const projects = lists.projects
    .filter((one) => !known.has(one.id))
    .map((one) => blank("project", one.id, one.title));
  const apps = lists.apps
    .filter((one) => !known.has(one.id))
    .map((one) => blank("app", one.id, one.name));
  if (projects.length === 0 && apps.length === 0) return workspaces;
  const of = (kind: WorkspaceView["kind"]) =>
    workspaces.filter((one) => one.kind === kind);
  return [...of("home"), ...of("project"), ...projects, ...of("app"), ...apps];
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
