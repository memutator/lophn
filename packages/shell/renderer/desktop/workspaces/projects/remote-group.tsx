// In a window of another machine (M): the line under each of M's projects that says whether it is also on this computer.
// M's list comes from the window's core, this computer's from shell main (`thisRead`). Each side keeps its last good list,
// so a failed read or a lost connection shows the last grouping. Sessions are never merged: each machine reads its own.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { Popover } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";

import { agentList } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionList } from "../../../../../protocol/lophn-agent/agent-sessions.ts";
import { projectApi } from "../../../../../protocol/projects/project-api.ts";
import { readRoute, useCoreRead } from "../../connection/core-read.ts";
import { useEventClient } from "../../connection/events/hooks.tsx";
import {
  useMachines,
  useMachinesView,
  useWindowMachine,
} from "../../machines/context.tsx";
import type { MachineItem, MachinesSource } from "../../machines/source.ts";
import {
  groupProjects,
  type ProjectRow,
  type RemoteGroup,
} from "./remote-group.ts";
import styles from "./remote-group.module.css";

const ALL = { limit: Number.MAX_SAFE_INTEGER };
const SESSIONS_SHOWN = 8;

interface Groups {
  readonly machine: MachineItem;
  readonly source: MachinesSource;
  readonly groups: ReadonlyMap<string, RemoteGroup>;
  readonly reloadHere: () => void;
}

const GroupsContext = createContext<Groups | null>(null);

/** Reads and groups both lists in a window of another machine. Elsewhere it is only its children. */
export function RemoteGroupsProvider({ children }: { children: ReactNode }) {
  const machine = useWindowMachine();
  const source = useMachines();
  if (machine === null || source === null) return children;
  return (
    <Reading machine={machine} source={source}>
      {children}
    </Reading>
  );
}

function Reading({
  machine,
  source,
  children,
}: {
  machine: MachineItem;
  source: MachinesSource;
  children: ReactNode;
}) {
  const there = useCoreRead(projectApi.list, ALL).loaded;
  const [here, setHere] = useState<readonly ProjectRow[] | null>(null);
  const reloadHere = useCallback(() => {
    void source.thisRead("project.list", ALL).then((read) => {
      if (read.ok) setHere((read.value as { projects: ProjectRow[] }).projects);
    });
  }, [source]);
  // This computer's core sends no events to this window: read again when the window comes back to the front.
  useEffect(() => {
    reloadHere();
    globalThis.addEventListener("focus", reloadHere);
    return () => globalThis.removeEventListener("focus", reloadHere);
  }, [reloadHere]);
  const thereRows = there.state === "ready" ? there.value.projects : null;
  const groups = useMemo(
    () =>
      here === null || thereRows === null
        ? new Map<string, RemoteGroup>()
        : groupProjects(here, thereRows, machine.id),
    [here, thereRows, machine.id],
  );
  const value = useMemo(
    () => ({ machine, source, groups, reloadHere }),
    [machine, source, groups, reloadHere],
  );
  return (
    <GroupsContext.Provider value={value}>{children}</GroupsContext.Provider>
  );
}

/** The line under one of M's project rows. Nothing outside a window of another machine or for an unmatched project. */
export function RemoteGroupLine({
  project,
  title,
  onOpenSession,
}: {
  project: string;
  /** The project's title on M. */
  title: string;
  /** Opens one of M's sessions in this window. */
  onOpenSession: (session: string) => void;
}) {
  const groups = useContext(GroupsContext);
  const group = groups?.groups.get(project);
  if (groups === null || group === undefined) return null;
  switch (group.kind) {
    case "same":
      return (
        <Popover
          placement="beside"
          trigger={
            <button
              type="button"
              className={styles.link}
              data-remote-group="same"
            >
              {group.here.title === title
                ? t("machines.group.also-here")
                : t("machines.group.also-here-as", { title: group.here.title })}
            </button>
          }
        >
          <SideBySide
            groups={groups}
            there={project}
            here={group.here.id}
            onOpenSession={onOpenSession}
          />
        </Popover>
      );
    case "remoteOnly":
      return group.url === null ? (
        <p className={styles.note} data-remote-group="remote-only">
          {t("machines.group.no-remote")}
        </p>
      ) : (
        <CloneHere
          groups={groups}
          url={group.url}
          identity={group.identity}
          title={title}
        />
      );
    case "suggested":
      return (
        <div className={styles.block} data-remote-group="suggested">
          <span className={styles.label}>
            {t("machines.group.looks-like", { title: group.here.title })}
          </span>
          <p className={styles.note}>{t("machines.group.looks-like-note")}</p>
        </div>
      );
  }
}

type CloneState =
  | { readonly state: "idle" }
  | { readonly state: "cloning" }
  | { readonly state: "done"; readonly text: string }
  | { readonly state: "failed"; readonly text: string };

function CloneHere({
  groups,
  url,
  identity,
  title,
}: {
  groups: Groups;
  url: string;
  identity: string;
  title: string;
}) {
  const [clone, setClone] = useState<CloneState>({ state: "idle" });
  const run = async () => {
    setClone({ state: "cloning" });
    const outcome = await groups.source.cloneHere({ url, identity, title });
    if (outcome.ok) {
      setClone({
        state: "done",
        text: t("machines.group.cloned", { path: outcome.path }),
      });
      groups.reloadHere();
    } else if (outcome.reason === "cancelled") setClone({ state: "idle" });
    else
      setClone({
        state: "failed",
        text:
          outcome.reason === "git_auth"
            ? t("machines.group.git-auth", { command: outcome.command })
            : t("machines.group.clone-failed", { message: outcome.message }),
      });
  };
  return (
    <div className={styles.block} data-remote-group="remote-only">
      <div className={styles.line}>
        <span className={styles.label}>{t("machines.group.not-here")}</span>
        <Button
          size="sm"
          disabled={clone.state === "cloning"}
          onClick={() => void run()}
          data-clone-here=""
        >
          {clone.state === "cloning"
            ? t("machines.group.cloning")
            : t("machines.group.clone-here")}
        </Button>
      </div>
      {clone.state === "done" ? (
        <p className={styles.note}>{clone.text}</p>
      ) : clone.state === "failed" ? (
        <p className={styles.error}>{clone.text}</p>
      ) : null}
    </div>
  );
}

type SessionRow = {
  readonly id: string;
  readonly title: string | null;
  readonly agent: string;
};
type Column =
  | { readonly state: "loading" | "failed" }
  | {
      readonly state: "ready";
      readonly rows: readonly SessionRow[];
    };

type SessionRead = (
  route: "ListAgents" | "ListSessions",
  input: unknown,
) => Promise<{ readonly ok: boolean; readonly value?: unknown }>;

// Every agent's sessions in the project workspace, newest first. `ListSessions` takes one agent, so the workspace's agents
// are read first. null when any read fails.
async function workspaceSessions(
  read: SessionRead,
  project: string,
): Promise<SessionRow[] | null> {
  const workspace = { kind: "project" as const, id: project };
  const agents = await read("ListAgents", { workspace });
  if (!agents.ok) return null;
  const { agents: rows } = agents.value as {
    agents: { agent: string; name: string }[];
  };
  const lists = await Promise.all(
    rows.map(async (row) => {
      const listed = await read("ListSessions", {
        agent: row.agent,
        workspace,
      });
      if (!listed.ok) return null;
      const { sessions } = listed.value as {
        sessions: {
          id: string;
          title: string | null;
          last_active_at: string | null;
        }[];
      };
      return sessions.map((session) => ({ ...session, agent: row.name }));
    }),
  );
  if (lists.some((list) => list === null)) return null;
  return lists
    .flatMap((list) => list ?? [])
    .sort((a, b) =>
      (b.last_active_at ?? "").localeCompare(a.last_active_at ?? ""),
    )
    .slice(0, SESSIONS_SHOWN)
    .map((row) => ({ id: row.id, title: row.title, agent: row.agent }));
}

// Two lists side by side, each read from its own machine's core. A failed read keeps what the column showed.
function SideBySide({
  groups,
  there,
  here,
  onOpenSession,
}: {
  groups: Groups;
  there: string;
  here: string;
  onOpenSession: (session: string) => void;
}) {
  const core = useEventClient().core;
  const thisComputer = useMachinesView()?.thisComputer ?? null;
  const [left, setLeft] = useState<Column>({ state: "loading" });
  const [right, setRight] = useState<Column>({ state: "loading" });
  useEffect(() => {
    const keep = (rows: SessionRow[] | null) => (now: Column) =>
      rows !== null
        ? { state: "ready" as const, rows }
        : now.state === "ready"
          ? now
          : { state: "failed" as const };
    const readThere: SessionRead = (route, input) =>
      route === "ListAgents"
        ? readRoute(core, agentList, input as never)
        : readRoute(core, workspaceSessionList, input as never);
    void workspaceSessions(readThere, there).then((rows) =>
      setLeft(keep(rows)),
    );
    void workspaceSessions(
      (route, input) => groups.source.thisRead(route, input),
      here,
    ).then((rows) => setRight(keep(rows)));
  }, [core, groups.source, there, here]);
  return (
    <div className={styles.columns} data-remote-sessions="">
      <SessionColumn
        name={groups.machine.name}
        column={left}
        onOpen={onOpenSession}
      />
      <SessionColumn
        name={thisComputer?.name ?? t("machines.button.this-computer")}
        column={right}
        onOpen={(session) => {
          if (thisComputer !== null) {
            void groups.source.open(thisComputer.id, session);
          }
        }}
      />
    </div>
  );
}

function SessionColumn({
  name,
  column,
  onOpen,
}: {
  name: string;
  column: Column;
  onOpen: (session: string) => void;
}) {
  return (
    <div className={styles.column}>
      <span className={styles.label}>
        {t("machines.group.sessions-on", { name })}
      </span>
      {column.state === "failed" ? (
        <p className={styles.error}>{t("machines.group.sessions-failed")}</p>
      ) : column.state === "ready" && column.rows.length === 0 ? (
        <p className={styles.note}>{t("machines.group.no-sessions")}</p>
      ) : column.state === "ready" ? (
        column.rows.map((row) => (
          <button
            key={row.id}
            type="button"
            className={styles.session}
            onClick={() => onOpen(row.id)}
          >
            <span className={styles.title}>
              {row.title ?? t("left-sidebar.label.untitled")}
            </span>
            <span className={styles.agent}>{row.agent}</span>
          </button>
        ))
      ) : null}
    </div>
  );
}
