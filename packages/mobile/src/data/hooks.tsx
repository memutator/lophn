// The hooks screens read. `DataProvider` holds the computer store and mounts the desktop `EventsProvider` for the computer
// on screen, so the desktop conversation hooks (useAgentTabData) run unchanged on the phone.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { appList } from "../../../protocol/apps/apps.ts";
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
import { decideChoiceOf } from "../../../shell/renderer/conversation/agent-view-model.ts";
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
  decideShare,
  decideWaiting,
  dismissNotice,
  readQuestions,
  type WaitingChoice,
} from "../../../shell/renderer/desktop/connection/waiting/decide.ts";
import { markNoticesRead } from "../../../shell/renderer/desktop/connection/waiting/history.ts";
import type { InboxNames } from "../../../shell/renderer/desktop/connection/waiting/names.ts";
import { newId } from "../../../shell/renderer/prefixed-id.ts";
import type { ComputerItem, Computers, ComputersState } from "./computers.ts";
import { type ComputerData, dataOf, type SampleConversation } from "./link.ts";
import { type Known, type WorkspaceView, workspacesOf } from "./workspaces.ts";

interface Data {
  readonly computers: Computers<ComputerData>;
  readonly data: ComputerData;
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
  const state = useSyncExternalStore(computers.subscribe, computers.get);
  useEffect(() => {
    void computers.start();
    const subscription = AppState.addEventListener("change", (app) => {
      if (app === "active") computers.resume();
      else computers.pause();
    });
    return () => subscription.remove();
  }, [computers]);
  const data =
    (state.current === null
      ? undefined
      : computers.link(state.current)?.data) ?? NO_COMPUTER;
  const value = useMemo(() => ({ computers, data }), [computers, data]);
  return (
    <DataContext.Provider value={value}>
      <EventsProvider client={data.client}>{children}</EventsProvider>
    </DataContext.Provider>
  );
}

// ---- computers

export interface ComputersView extends ComputersState {
  select(key: string): void;
  add: Computers<ComputerData>["add"];
  remove(key: string): void;
  rename(key: string, name: string): void;
}

export function useComputers(): ComputersView {
  const { computers } = useData();
  const state = useSyncExternalStore(computers.subscribe, computers.get);
  return {
    ...state,
    select: computers.select,
    add: computers.add,
    remove: computers.remove,
    rename: computers.rename,
  };
}

export function useCurrentComputer(): ComputerItem | null {
  const { computers, current } = useComputers();
  return computers.find((one) => one.key === current) ?? null;
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
                      profile: one.value.effective.profile.value,
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

function useWaitingState(): WaitingState {
  const { waiting } = useData().data;
  return useSyncExternalStore(waiting.subscribe, waiting.get);
}

/** Home, every project and every app of the computer on screen, each with its sessions and Recent. */
export function useWorkspaces(): readonly WorkspaceView[] {
  const { data } = useData();
  const { sessions } = useSessions();
  const { entries } = useWaitingState();
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
  jobApproval(
    entry: WaitingEntry & { kind: "job_approval" },
    choice: "approve" | "reject",
  ): Promise<Done>;
  share(
    entry: WaitingEntry & { kind: "share" },
    choice: "approve" | "reject",
  ): Promise<Done>;
  dismiss(notice: string): Promise<Done>;
  markRead(notices: readonly string[]): Promise<boolean>;
}

/** What waits on the person on the computer on screen, in the desktop waiting model's own types, and the answers to it. */
export function useInbox(): Inbox {
  const { core } = useData().data;
  const state = useWaitingState();
  return useMemo(
    () => ({
      ...state,
      decide: (entry, choice, reason) =>
        decideWaiting(core, entry, choice, reason),
      questions: (entry) => readQuestions(core, entry),
      answer: (entry, answers) => answerQuestion(core, entry, answers),
      jobHold: (entry, choice) => decideJobHold(core, entry, choice),
      jobApproval: (entry, choice) => decideJobApproval(core, entry, choice),
      share: (entry, choice) => decideShare(core, entry, choice),
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

function useSource({ agent, workspace }: Omit<ConversationTarget, "session">) {
  const { sources } = useData().data;
  return useMemo(
    () =>
      sources({
        assignment: agent,
        workspace: workspace ?? { kind: "global", id: "" },
      }),
    [sources, agent, workspace?.kind, workspace?.id],
  );
}

/** One session's conversation: the desktop Agent tab's view (thread, live text, pending, queued) and its actions. */
export function useConversation(target: ConversationTarget): Conversation {
  const { session } = target;
  const source = useSource(target);
  const data = useAgentTabData(source, session);
  const approval = data.thread?.pending.approval ?? null;
  const asked = data.thread?.pending.questions ?? null;
  const send = useCallback(
    (text: string, delivery: Delivery = "next_turn") => {
      const message = newId("msg");
      return source.send({
        session,
        id: message,
        key: `session-messages-send-${message}`,
        content: textBlocks(text),
        delivery,
      });
    },
    [source, session],
  );
  return {
    ...data,
    source,
    send,
    stop: () => source.stopSession(session),
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
      });
      return sent.ok
        ? { ok: true, value: { session, agent, workspace } }
        : sent;
    },
    [sources],
  );
}
