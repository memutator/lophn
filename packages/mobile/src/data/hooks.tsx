// The hooks screens read. `DataProvider` holds the computer store and mounts the desktop `EventsProvider` for the computer
// on screen, so the desktop conversation hooks (useAgentTabData) run unchanged on the phone. `ComputerScope` points the
// same hooks at another paired computer: the one list reads every computer's lines through it.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { appList } from "../../../protocol/apps/apps.ts";
import { idSchema } from "../../../protocol/base/ids.ts";
import {
  type CodingSession,
  codingSessionsList,
} from "../../../protocol/coding-agent/relay.ts";
import { agentRead } from "../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionList } from "../../../protocol/lophn-agent/agent-sessions.ts";
import type { AskAnswer } from "../../../protocol/lophn-agent/ask-tool.ts";
import { textBlocks } from "../../../protocol/lophn-agent/content-block.ts";
import {
  type AgentId,
  lophnIdOf,
  type Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import { projectApi } from "../../../protocol/projects/project-api.ts";
import { coreAgentTabSourceFactory } from "../../../shell/renderer/conversation/agent-tab-core-source.ts";
import {
  type AgentTabData,
  useAgentTabData,
} from "../../../shell/renderer/conversation/agent-tab-data.ts";
import type {
  AgentTabSource,
  Delivery,
  QuestionAnswer,
  SourceResult,
} from "../../../shell/renderer/conversation/agent-tab-source.ts";
import { decideChoiceOf, messagesOf } from "../../../shell/renderer/conversation/agent-view-model.ts";
import { seenOf } from "../../../shell/renderer/conversation/delivery-state.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import {
  readRoute,
  readsOf,
  useCoreRead,
  useFollowedRead,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import {
  EventsProvider,
  useSessions,
  useWaiting,
} from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import type { SessionEntry } from "../../../shell/renderer/desktop/connection/events/sessions-store.ts";
import type {
  WaitingEntry,
  WaitingState,
} from "../../../shell/renderer/desktop/connection/events/waiting-store.ts";
import {
  answerQuestion,
  decideJobApproval,
  decideJobHold,
  decideMailHold,
  decideWaiting,
  dismissNotice,
  readQuestions,
  type WaitingChoice,
} from "../../../shell/renderer/desktop/connection/waiting/decide.ts";
import type { MachineNameOf } from "../../../shell/renderer/desktop/jobs/model.ts";
import { markNoticesRead } from "../../../shell/renderer/desktop/connection/waiting/history.ts";
import type { InboxNames } from "../../../shell/renderer/desktop/connection/waiting/names.ts";
import { newId } from "../../../shell/renderer/prefixed-id.ts";
import type { CodingActions, CodingTarget } from "./coding.ts";
import type {
  ComputerItem,
  Computers,
  ComputersState,
} from "../../../remote-client/mod.ts";
import {
  type Every,
  TERMINAL_LOADING,
  type TerminalFeed,
  type TerminalSnapshot,
  type TerminalState,
  terminalFeed,
} from "./terminal.ts";
import { loadComputers } from "../pairing/store.ts";
import {
  createPhoneDraftStore,
  type PhoneDraftStore,
  type SessionDraft,
} from "./drafts.ts";
import { type ComputerData, dataOf, type SampleConversation } from "./link.ts";
import { followLocalComputers } from "./local-stores.ts";
import { type Known, type WorkspaceView, workspacesOf } from "./workspaces.ts";

interface Data {
  readonly computers: Computers<ComputerData>;
  /** The computer the hooks below read: the one on screen, or the one a `ComputerScope` names. */
  readonly key: string | null;
  readonly data: ComputerData;
  readonly drafts: PhoneDraftStore;
  /** Keys of saved computers currently marked disputed in the roster view. */
  readonly disputed: ReadonlySet<string>;
}

const DataContext = createContext<Data | null>(null);

// No computer yet (or none paired): screens still get empty lists instead of a missing provider.
const OFFLINE: CoreSource = {
  subscribe: () => () => {},
  call: () =>
    Promise.resolve({
      ok: false,
      error: { code: "unavailable", message: "no computer" },
    }),
};
const NO_COMPUTER = dataOf(OFFLINE, coreAgentTabSourceFactory(OFFLINE)).data;

function useData(): Data {
  const found = useContext(DataContext);
  if (found === null) throw new Error("DataProvider is missing");
  return found;
}

/** Mount once at the app root. Starts the store, follows the app going to the background, and serves the chosen computer. */
export function DataProvider({
  computers,
  children,
}: {
  computers: Computers<ComputerData>;
  children: ReactNode;
}) {
  const [drafts] = useState(createPhoneDraftStore);
  const [disputed, setDisputed] = useState<ReadonlySet<string>>(() => new Set());
  const state = useSyncExternalStore(computers.subscribe, computers.get);
  const revokedKeys = state.computers
    .filter((one) => one.status === "revoked")
    .map((one) => one.key)
    .join("\n");
  useEffect(() => {
    if (!state.ready || revokedKeys === "") {
      setDisputed((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    let live = true;
    void loadComputers().then((saved) => {
      if (!live) return;
      setDisputed(
        new Set(
          saved
            .filter((one) => one.disputed === true)
            .map((one) => one.key),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [state.ready, revokedKeys]);
  useEffect(() => followLocalComputers(computers), [computers]);
  useEffect(() => {
    void computers.start();
    const subscription = AppState.addEventListener("change", (app) => {
      if (app === "active") computers.resume();
      else computers.pause();
    });
    return () => subscription.remove();
  }, [computers]);
  return (
    <Scope
      computers={computers}
      computer={state.current}
      drafts={drafts}
      disputed={disputed}
    >
      {children}
    </Scope>
  );
}

function Scope({
  computers,
  computer,
  drafts,
  disputed,
  children,
}: {
  computers: Computers<ComputerData>;
  computer: string | null;
  drafts: PhoneDraftStore;
  disputed: ReadonlySet<string>;
  children: ReactNode;
}) {
  const data =
    (computer === null ? undefined : computers.link(computer)?.data) ??
    NO_COMPUTER;
  const value = useMemo(
    () => ({ computers, key: computer, data, drafts, disputed }),
    [computers, computer, data, drafts, disputed],
  );
  return (
    <DataContext.Provider value={value}>
      <EventsProvider stores={data.stores}>{children}</EventsProvider>
    </DataContext.Provider>
  );
}

/**
 * The hooks inside read `computer` instead of the computer on screen, without switching to it: a line of another
 * computer in the one list, or the card that answers its Inbox.
 */
export function ComputerScope({
  computer,
  children,
}: {
  computer: string;
  children: ReactNode;
}) {
  const { computers, drafts, disputed } = useData();
  useSyncExternalStore(computers.subscribe, computers.get);
  return (
    <Scope
      computers={computers}
      computer={computer}
      drafts={drafts}
      disputed={disputed}
    >
      {children}
    </Scope>
  );
}

/** True once the current computer's session store has published its first snapshot. */
export function useSessionsSettled(): boolean {
  const { sessionsSettled } = useData().data;
  return useSyncExternalStore(sessionsSettled.subscribe, sessionsSettled.get);
}

/** In-memory draft for one session (chat text, attachments, terminal input); survives chat <-> terminal view swaps. */
export function useSessionDraft(session: string): {
  readonly draft: SessionDraft;
  save(patch: Partial<SessionDraft>): void;
  update(fn: (current: SessionDraft) => Partial<SessionDraft>): void;
} {
  const { drafts, key } = useData();
  const id = `${key ?? ""}\0${session}`;
  const draft = useSyncExternalStore(
    useCallback((listener) => drafts.subscribe(id, listener), [drafts, id]),
    useCallback(() => drafts.get(id), [drafts, id]),
  );
  const save = useCallback(
    (patch: Partial<SessionDraft>) => drafts.save(id, patch),
    [drafts, id],
  );
  const update = useCallback(
    (fn: (current: SessionDraft) => Partial<SessionDraft>) => drafts.update(id, fn),
    [drafts, id],
  );
  return useMemo(() => ({ draft, save, update }), [draft, save, update]);
}

// ---- computers

export interface ComputersView extends ComputersState {
  readonly disputed: ReadonlySet<string>;
  select(key: string): void;
  add: Computers<ComputerData>["add"];
  remove(key: string): void;
  /** Sets the alias; null clears it and the name the computer announced shows again. */
  rename(key: string, name: string | null): void;
  /** Names this phone for every computer. */
  setDeviceName(name: string): Promise<void>;
  /** Dials a computer that is not connected right now instead of waiting for the next backoff. */
  retry(): void;
}

export function useComputers(): ComputersView {
  const { computers, disputed } = useData();
  const state = useSyncExternalStore(computers.subscribe, computers.get);
  return {
    ...state,
    disputed,
    select: computers.select,
    add: computers.add,
    remove: computers.remove,
    rename: computers.rename,
    setDeviceName: computers.setDeviceName,
    retry: computers.resume,
  };
}

/** A paired computer's name by its machine id, for text that names another computer; null when this phone has not paired it. */
export function useMachineNameOf(): MachineNameOf {
  const { computers } = useComputers();
  return useCallback(
    (machine) => computers.find((one) => one.machine === machine)?.name ?? null,
    [computers],
  );
}

/** The computer on screen, or the one the enclosing `ComputerScope` names. */
export function useCurrentComputer(): ComputerItem | null {
  const { key } = useData();
  const { computers } = useComputers();
  return computers.find((one) => one.key === key) ?? null;
}

/** One paired computer's data, whether or not it is on screen; null when it is not paired. Reading it switches nothing. */
export function useComputerData(key: string): ComputerData | null {
  const { computers } = useData();
  useSyncExternalStore(computers.subscribe, computers.get);
  return computers.link(key)?.data ?? null;
}

/** Only on the sample computer: switches the Weekly report conversation between done, working, approval and question. */
export function useSampleConversation():
  | ((state: SampleConversation) => void)
  | null {
  return useData().data.sample?.conversation ?? null;
}

// ---- workspaces

const ALL = { limit: Number.MAX_SAFE_INTEGER };
const NOTHING: Known = { titles: new Map(), agents: new Map() };

/** Project and app names by id, the shape the desktop Inbox card model takes (`cardOf`). */
export function useNames(): InboxNames & {
  readonly list: {
    projects: readonly { id: string; title: string }[];
    apps: readonly { id: string; name: string }[];
  };
} {
  const projects = useCoreRead(projectApi.list, ALL).loaded;
  const apps = useCoreRead(appList, ALL).loaded;
  return useMemo(() => {
    const projectList =
      projects.state === "ready" ? projects.value.projects : [];
    const appList_ = apps.state === "ready" ? apps.value.apps : [];
    return {
      projects: new Map(projectList.map((one) => [one.id, one.title])),
      apps: new Map(appList_.map((one) => [one.id, one.name])),
      list: { projects: projectList, apps: appList_ },
    };
  }, [projects, apps]);
}

const pairOf = (entry: SessionEntry) =>
  `${entry.agent}\0${entry.workspace?.kind ?? ""}\0${entry.workspace?.id ?? ""}`;

/** Titles and times per agent × workspace pair (every page) and each agent's name and face. Re-read when sessions come or go. */
function useKnown(entries: readonly SessionEntry[]): Known {
  const live = entries.filter((entry) => entry.agent !== null);
  const pairs = [...new Set(live.map(pairOf))].sort();
  const agents = [...new Set(live.map((entry) => entry.agent!))].sort();
  const lists = pairs.map((pair) => {
    const [agent, kind, id] = pair.split("\0") as [AgentId, string, string];
    return {
      agent,
      workspace: kind === "" ? null : ({ kind, id } as Workspace),
    };
  });
  const read = useFollowedRead<Known>(
    async (core) => {
      const titles = new Map<string, { title: string | null; at: number }>();
      for (const input of lists) {
        let cursor: string | undefined;
        do {
          const page = await readRoute(core, workspaceSessionList, {
            ...input,
            ...(cursor === undefined ? {} : { cursor }),
          });
          if (!page.ok) break;
          for (const one of page.value.sessions) {
            titles.set(one.id, {
              title: one.title,
              at: Date.parse(one.last_active_at ?? "") || 0,
            });
          }
          cursor = page.value.next_cursor ?? undefined;
        } while (cursor !== undefined);
      }
      const faces: Known["agents"] = new Map(
        (
          await Promise.all(
            agents.map(async (agent) => {
              const one = await readRoute(core, agentRead, { agent });
              return one.ok
                ? ([
                    agent,
                    {
                      name: one.value.effective.name.value,
                      avatar: one.value.effective.avatar.value,
                    },
                  ] as const)
                : null;
            }),
          )
        ).filter((one) => one !== null),
      );
      return { ok: true, value: { titles, agents: faces } };
    },
    [
      ...lists.flatMap((input) => readsOf(workspaceSessionList, input)),
      ...agents.flatMap((agent) => readsOf(agentRead, { agent })),
    ],
    // A new session needs its title read; a turn starting may have just given it one.
    `${pairs.join()}|${entries.map((entry) => `${entry.session}:${entry.state}`).join()}`,
  ).loaded;
  return read.state === "ready" ? read.value : NOTHING;
}

/** Home, every project and every app of the computer on screen, each with its sessions and Recent. */
export function useWorkspaces(): readonly WorkspaceView[] {
  const { data } = useData();
  const { sessions } = useSessions();
  const { entries } = useWaiting();
  const names = useNames();
  const known = useKnown(sessions);
  return useMemo(
    () =>
      workspacesOf({
        now: Date.now(),
        sessions,
        waiting: entries,
        projects: names.list.projects,
        apps: names.list.apps,
        known,
        deskOf: data.deskOf,
      }),
    [sessions, entries, names, known, data],
  );
}

// ---- Inbox

type Done = { readonly ok: true } | { readonly ok: false; readonly code: string };

export interface Inbox extends WaitingState {
  /** Permission request (once, always, reject) or app update (allow, reject). */
  decide(
    entry: WaitingEntry,
    choice: WaitingChoice,
    reason?: string,
  ): Promise<Done>;
  questions(
    entry: WaitingEntry & { kind: "question" },
  ): ReturnType<typeof readQuestions>;
  answer(
    entry: WaitingEntry & { kind: "question" },
    answers: readonly AskAnswer[],
  ): Promise<Done>;
  /** A job's missed turn: run it now or skip it. */
  jobHold(
    entry: WaitingEntry & { kind: "job_hold" },
    choice: "run_now" | "skip",
  ): Promise<Done>;
  /** Mail that came late from another computer: run it now or skip it. */
  mailHold(
    entry: WaitingEntry & { kind: "mail_hold" },
    choice: "run_now" | "skip",
  ): Promise<Done>;
  jobApproval(
    entry: WaitingEntry & { kind: "job_approval" },
    choice: "approve" | "reject",
  ): Promise<Done>;
  dismiss(notice: string): Promise<Done>;
  markRead(notices: readonly string[]): Promise<boolean>;
}

/** What waits on the person on the computer on screen, in the desktop waiting model's own types, and the answers to it. */
export function useInbox(): Inbox {
  const { core } = useData().data;
  const state = useWaiting();
  return useMemo(
    () => ({
      ...state,
      decide: (entry, choice, reason) =>
        decideWaiting(core, entry, choice, reason),
      questions: (entry) => readQuestions(core, entry),
      answer: (entry, answers) => answerQuestion(core, entry, answers),
      jobHold: (entry, choice) => decideJobHold(core, entry, choice),
      mailHold: (entry, choice) => decideMailHold(core, entry, choice),
      jobApproval: (entry, choice) => decideJobApproval(core, entry, choice),
      dismiss: (notice) => dismissNotice(core, notice),
      markRead: (notices) => markNoticesRead(core, notices),
    }),
    [core, state],
  );
}

// ---- conversation

/** A session and who runs it where. Session rows and Inbox items carry all three. */
export interface ConversationTarget {
  readonly session: string;
  readonly agent: AgentId;
  readonly workspace: Workspace | null;
}

export interface Conversation extends AgentTabData {
  /** The desktop conversation source, for everything the helpers below do not cover. */
  readonly source: AgentTabSource;
  send(text: string, delivery?: Delivery): Promise<SourceResult<void>>;
  stop(): Promise<SourceResult<void>>;
  /** Answers the approval card (`thread.pending.approval`). */
  decide(
    choice: "once" | "session" | "always" | "reject",
    reason?: string,
  ): Promise<SourceResult<unknown>>;
  /** Answers the question card (`thread.pending.questions`). */
  answer(answers: readonly QuestionAnswer[]): Promise<SourceResult<void>>;
}

function useSource(target: ConversationTarget | CodingTarget): AgentTabSource {
  const { sources, coding } = useData().data;
  const lophn = "agent" in target ? target : null;
  const chat = "coding" in target ? target : null;
  const lophnSource = useMemo(
    () =>
      lophn === null
        ? null
        : sources({
            assignment: lophn.agent,
            workspace: lophn.workspace ?? { kind: "global", id: "" },
          }),
    [sources, lophn?.agent, lophn?.workspace?.kind, lophn?.workspace?.id],
  );
  const codingSource = useMemo(
    () => (chat === null ? null : coding.source(chat)),
    [coding, chat?.session, chat?.coding.harness, chat?.coding.cwd],
  );
  return (lophnSource ?? codingSource)!;
}

const SESSION_ID = idSchema("ses");

// What a conversation reads when its session id is not one: every read and action answers not_found without a call, so
// a bad id never reaches the core (the watch side is dropped by the connection).
const NO_SESSION = new Proxy({} as AgentTabSource, {
  get: (_target, key) =>
    key === "changed" || key === "draft"
      ? undefined
      : () => Promise.resolve({ ok: false, code: "not_found" }),
});

/** One session's conversation: the desktop Agent tab's view (thread, live text, pending, queued) and its actions. */
export function useConversation(
  target: ConversationTarget | CodingTarget,
): Conversation {
  const { session } = target;
  const real = useSource(target);
  const source = SESSION_ID.safeParse(session).success ? real : NO_SESSION;
  const data = useAgentTabData(source, session);
  const approval = data.thread?.pending.approval ?? null;
  const asked = data.thread?.pending.questions ?? null;
  const turn = data.thread?.turn?.phase === "ended" ? null : (data.thread?.turn ?? null);
  const send = useCallback(
    (text: string, delivery: Delivery = "next_turn") => {
      const message = newId("msg");
      return source.send({
        session,
        id: message,
        key: `session-messages-send-${message}`,
        content: textBlocks(text),
        delivery,
        seen: seenOf(data.thread === null ? null : messagesOf(data.thread), data.thread?.queued ?? [], null),
      });
    },
    [source, session, data.thread],
  );
  return {
    ...data,
    source,
    send,
    // A coding session has no session to stop on the core; its running turn is stopped by id.
    stop: () =>
      "coding" in target
        ? turn === null
          ? Promise.resolve({ ok: true, value: undefined })
          : source.stop(turn.id, newId("stop"))
        : source.stopSession(session),
    decide: (choice, reason) =>
      approval === null
        ? Promise.resolve({ ok: false, code: "not_found" })
        : source.act(session, {
            type: "decide",
            session,
            request: approval.id,
            choice: decideChoiceOf(choice, reason),
          }),
    answer: (answers) =>
      asked === null
        ? Promise.resolve({ ok: false, code: "not_found" })
        : source.answerQuestions({
            session,
            toolCall: asked.toolCall,
            answers,
          }),
  };
}

export interface CodingSessionsView {
  readonly sessions: CodingSession[];
  /** `failed`: the first read did not go through; `reload` tries it again. */
  readonly status: "loading" | "ready" | "failed";
  reload(): void;
}

/** The computer's coding sessions (of one project when given). Read again when the list changes and after a reconnect. */
export function useCodingSessions(project?: string): CodingSessionsView {
  const { loaded, reload } = useCoreRead(
    codingSessionsList,
    project === undefined ? {} : { project: project as `prj_${string}` },
  );
  return useMemo(
    () =>
      loaded.state === "ready"
        ? { sessions: loaded.value.sessions, status: "ready", reload }
        : { sessions: [], status: loaded.state, reload },
    [loaded, reload],
  );
}

/** What the computer's coding sessions can be told to do: switch view, open one, open a terminal. */
export function useCodingActions(): CodingActions {
  return useData().data.coding;
}

export interface TerminalView {
  readonly screen: TerminalSnapshot | null;
  readonly status: TerminalState["status"];
  /** This phone may type into the terminal (the person turned it on for this phone on the computer). */
  readonly input: boolean;
  send(text: string): Promise<SourceResult<void>>;
  /** Sizes the terminal to this phone's screen (`TerminalFeed.resize`). */
  resize(columns: number, rows: number): void;
}

const everyInterval: Every = (ms, run) => {
  const timer = setInterval(run, ms);
  return () => clearInterval(timer);
};

/**
 * A terminal's screen on the computer, watched while the screen is open; null watches nothing (the app is in the
 * background). The last screen stays while it is not watched.
 */
export function useTerminal(terminal: string | null): TerminalView {
  const { client } = useData().data;
  const [state, setState] = useState<TerminalState>(TERMINAL_LOADING);
  const feed = useRef<TerminalFeed | null>(null);
  // The last size asked for: a new watch (back from the background) claims it again.
  const size = useRef<{ columns: number; rows: number } | null>(null);
  // Keeps one retry key per logical input attempt even if the app backgrounds and reconnects before retry.
  const retry = useRef<{ terminal: string; text: string; key: string } | null>(null);
  const currentTerminal = useRef<string | null>(terminal);
  if (terminal !== null) currentTerminal.current = terminal;
  useEffect(() => {
    if (terminal === null) return;
    if (retry.current !== null && retry.current.terminal !== terminal) {
      retry.current = null;
    }
    const watching = terminalFeed(client, terminal, everyInterval, setState);
    feed.current = watching;
    if (size.current !== null) {
      watching.resize(size.current.columns, size.current.rows);
    }
    return () => {
      feed.current = null;
      watching.stop();
    };
  }, [client, terminal]);
  const send = useCallback(
    async (text: string): Promise<SourceResult<void>> => {
      const target = currentTerminal.current;
      const key =
        retry.current !== null &&
        retry.current.terminal === target &&
        retry.current.text === text
          ? retry.current.key
          : newId("input");
      const watching = feed.current;
      if (watching === null) {
        if (target !== null) retry.current = { terminal: target, text, key };
        return { ok: false, code: "unavailable" };
      }
      const done = await watching.send(text, key);
      if (done.ok) retry.current = null;
      else if (target !== null) retry.current = { terminal: target, text, key };
      return done;
    },
    [],
  );
  const resize = useCallback(
    (columns: number, rows: number) => {
      size.current = { columns, rows };
      feed.current?.resize(columns, rows);
    },
    [],
  );
  return {
    screen: state.screen,
    status: state.status,
    input: state.screen?.input ?? false,
    send,
    resize,
  };
}

/**
 * Opens a new session in a workspace and sends its first message, as the desktop Agent tab does on the first message.
 * The agent defaults to the workspace's lophn. Resolves to the target to open the conversation with.
 */
export function useStartSession(): (input: {
  workspace: Workspace | null;
  agent?: AgentId;
  text: string;
}) => Promise<SourceResult<ConversationTarget>> {
  const { sources } = useData().data;
  return useCallback(
    async ({ workspace, agent = lophnIdOf(workspace), text }) => {
      const source = sources({
        assignment: agent,
        workspace: workspace ?? { kind: "global", id: "" },
      });
      const session = newId("ses");
      const opened = await source.openSession({ id: session });
      if (!opened.ok) return opened;
      const message = newId("msg");
      const sent = await source.send({
        session,
        id: message,
        key: `session-messages-send-${message}`,
        content: textBlocks(text),
        delivery: "next_turn",
        seen: null,
      });
      return sent.ok
        ? { ok: true, value: { session, agent, workspace } }
        : sent;
    },
    [sources],
  );
}
