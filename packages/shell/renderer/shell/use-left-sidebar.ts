// 왼쪽 sidebar가 읽는 값. 모든 기계의 workspace 목록(Home, project, app)과 session, session의 제목·시각이다.
// session store는 제목과 시각을 싣지 않아 agent × workspace마다 대화 source의 session 목록에서 읽는다.
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { codingSessionsList } from "../../../protocol/coding-agent/relay.ts";
import type { CodingSession } from "../../../protocol/coding-agent/relay.ts";
import { projectApi } from "../../../protocol/projects/project-api.ts";
import { useAppList } from "../apps/app-list.ts";
import type { AppRow } from "../apps/source.ts";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import {
  type Loaded,
  type ReadHandle,
  useCoreRead,
  useFollowedRead,
} from "../desktop/connection/core-read.ts";
import { useSessions } from "../desktop/connection/events/hooks.tsx";
import type { InboxNamesByMachine } from "../desktop/connection/waiting/names.ts";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import { useMachinesView } from "../desktop/machines/context.tsx";
import type { MachineData, OnMachine } from "../desktop/machines/data.ts";
import {
  MachineScope,
  type MachineRef,
  useMachineData,
  useMachineHub,
} from "../desktop/machines/scope.tsx";
import { projectItemOf } from "../desktop/workspaces/projects/core-source.ts";
import {
  type ListedProject,
  type MachineLists,
  type MergedWorkspace,
  mergeWorkspaces,
} from "../desktop/workspaces/projects/merged.ts";
import type { ProjectItem } from "../desktop/workspaces/projects/source.ts";
import { sessionOf } from "../workspace/agent/tab-fields.ts";
import { terminalRefOf } from "../workspace/kinds/terminal.tsx";
import {
  allTabs,
  workspaceKey,
  type WorkspaceRef,
  type TabItem,
} from "./desk-model.ts";
import type { LayoutSource } from "./layout-source.ts";
import {
  homeName,
  type KnownSessions,
  type LayoutDesks,
  type RemoteTerminal,
  layoutDesks,
} from "./left-sidebar-workspaces.ts";
import { sessionTitlesKey } from "./session-titles.ts";
import { useRemembered } from "./sidebar-memory.tsx";

// 목록 한 번에 모두 읽는다. 쓰는 화면이 보관한 것까지 가른다.
const ALL = { limit: Number.MAX_SAFE_INTEGER };

/** 보관한 project까지 모두. 순서는 core가 준 그대로다. */
export function useProjectList(): ReadHandle<readonly ProjectItem[]> {
  const read = useCoreRead(projectApi.list, ALL);
  const loaded = useMemo(
    (): Loaded<readonly ProjectItem[]> =>
      read.loaded.state === "ready"
        ? {
            ...read.loaded,
            value: read.loaded.value.projects.map(projectItemOf),
          }
        : read.loaded,
    [read.loaded],
  );
  return { loaded, reload: read.reload };
}

/** 이 컴퓨터의 project 목록 줄. clone할 remote 주소가 붙는다. */
export type ListedItem = ProjectItem & ListedProject;

/** 기계 하나의 목록과 session. */
export interface MachineSnapshot extends MachineLists {
  readonly projects: readonly ListedItem[];
  readonly apps: readonly AppRow[];
  readonly sessions: readonly SessionEntry[];
  /** 그 기계의 터미널에서 도는 coding agent. 이 컴퓨터의 것은 이 창의 terminal store가 알아 비어 있다. */
  readonly coding: readonly CodingSession[];
}

export interface SessionTitles {
  readonly known: KnownSessions;
  /** 화면이 먼저 안 제목(열린 대화가 읽은 것, 방금 바꾼 이름)을 넣는다. 탭 줄과 sidebar가 바로 따라간다. */
  readonly put: (session: string, title: string) => void;
}

export interface MachineListsValue {
  /** 창의 기계(null, 이 컴퓨터)가 맨 앞이고 그 뒤가 명단 순서다. */
  readonly lists: readonly MachineSnapshot[];
  readonly rows: readonly MergedWorkspace[];
  readonly entries: readonly OnMachine<SessionEntry>[];
  /** 다른 기계의 터미널 coding agent. 그 기계의 화면에서 시작한 것도 든다. */
  readonly terminals: readonly RemoteTerminal[];
  /** 모든 기계의 session 제목. session id는 기계를 건너 겹치지 않는다. */
  readonly sessionTitles: SessionTitles;
  /** 꺼진 기계. */
  readonly offline: ReadonlySet<string>;
  /** 기계 id → 명단의 이름. */
  readonly names: ReadonlyMap<string, string>;
  /** 기계(키 ""는 이 컴퓨터)의 project·앱 이름. Inbox 줄이 id 대신 쓴다. 목록 내용이 같으면 같은 값이다. */
  readonly inboxNames: InboxNamesByMachine;
  /** 줄의 기계(null은 창의 기계) 묶음. */
  dataOf(machine: MachineRef): MachineData;
}

const ListsContext = createContext<MachineListsValue | null>(null);

/** 창의 목록. `MachineListsProvider` 안에서만 쓴다. */
export function useMachineLists(): MachineListsValue {
  const value = useContext(ListsContext);
  if (value === null) throw new Error("MachineListsProvider is missing");
  return value;
}

type TitleRow = {
  readonly id: string;
  readonly title: string | null;
  readonly at: number;
};

type Seen = Partial<
  Pick<MachineSnapshot, "projects" | "apps" | "sessions" | "coding">
> & { readonly titles?: readonly TitleRow[] };

type Report = (machine: MachineRef, seen: Seen) => void;

// 기계 하나의 session 제목과 마지막 활동 시각. session 제목은 session store가 싣지 않아 agent × workspace마다 그 agent의 session
// 목록(page를 끝까지)에서 읽는다. 범위 안이라 그 기계의 `sessions` 변경으로 다시 읽는다(이름 바꾸기는 다른 창의 것도). 자동 제목은
// 변경을 내지 않아 session 줄이 바뀔 때(`sessionTitlesKey`) 다시 읽는다.
function useSessionTitles(
  sessions: readonly SessionEntry[],
  agentViewSource: AgentTabSourceFactory | undefined,
  live: boolean,
) {
  const pairs = useMemo(
    () =>
      live
        ? [
            ...new Set(
              sessions.flatMap((entry) =>
                entry.agent === null
                  ? []
                  : [
                      `${entry.agent}\0${entry.workspace?.kind ?? "global"}\0${entry.workspace?.id ?? ""}`,
                    ],
              ),
            ),
          ].sort()
        : [],
    [sessions, live],
  );
  return useFollowedRead(
    async () => {
      const lists = await Promise.all(
        pairs.map(async (pair) => {
          const [assignment, kind, id] = pair.split("\0") as [
            string,
            "global" | "project" | "app",
            string,
          ];
          const read = await agentViewSource?.({
            assignment,
            workspace: { kind, id },
          }).sessions();
          return read?.ok ? read.value : [];
        }),
      );
      return {
        ok: true as const,
        value: lists.flat().map(
          (entry): TitleRow => ({
            id: entry.id,
            title: entry.title,
            at: Date.parse(entry.activeAt) || 0,
          }),
        ),
      };
    },
    ["sessions"],
    `${pairs.join()}|${sessionTitlesKey(sessions)}`,
  ).loaded;
}

// 기계 하나의 project·앱·session과 그 제목을 그 기계의 범위에서 읽어 올린다. 꺼진 기계의 session store는 비거나 낡으므로 붙어 있을
// 때 본 것만 올린다.
function Reader({
  machine,
  live,
  report,
}: {
  machine: MachineRef;
  live: boolean;
  report: Report;
}) {
  const projects = useCoreRead(projectApi.list, ALL).loaded;
  const apps = useAppList().loaded;
  const { sessions } = useSessions();
  const titles = useSessionTitles(
    sessions,
    useMachineData().agentViewSource,
    live,
  );
  useEffect(() => {
    if (projects.state !== "ready") return;
    report(machine, {
      projects: projects.value.projects.map((row) => ({
        ...projectItemOf(row),
        remote: row.remote,
      })),
    });
  }, [machine, projects, report]);
  useEffect(() => {
    if (apps.state === "ready") report(machine, { apps: apps.value });
  }, [machine, apps, report]);
  useEffect(() => {
    if (live) report(machine, { sessions });
  }, [machine, live, sessions, report]);
  useEffect(() => {
    if (titles.state === "ready") report(machine, { titles: titles.value });
  }, [machine, titles, report]);
  return machine === null
    ? null
    : createElement(CodingReader, { machine, live, report });
}

// 다른 기계의 coding agent 터미널. 그 기계의 화면에서 시작한 것도 든다(폰이 읽는 길과 같다). 이 컴퓨터의 것은 이 창의 terminal
// store가 안다.
function CodingReader({
  machine,
  live,
  report,
}: {
  machine: MachineRef;
  live: boolean;
  report: Report;
}) {
  const coding = useCoreRead(codingSessionsList, {}).loaded;
  useEffect(() => {
    if (live && coding.state === "ready") {
      report(machine, { coding: coding.value.sessions });
    }
  }, [machine, live, coding, report]);
  return null;
}

/**
 * 창이 사는 동안 모든 기계의 목록을 읽어 들고 있다(workspace를 옮겨도 다시 읽지 않는다). 꺼진 기계는 이 실행 동안 마지막으로 본
 * 목록을 남긴다(저장하지 않는다).
 */
export function MachineListsProvider({ children }: { children: ReactNode }) {
  const view = useMachinesView();
  const hub = useMachineHub();
  if (hub === null) throw new Error("MachineHubProvider is missing");
  const roster = useMemo(
    () => (view?.machines ?? []).filter((one) => one.status !== "removed"),
    [view],
  );
  // 목록(project·앱)과 session을 따로 든다: session은 자주 바뀌고 줄(rows)은 목록만으로 짓는다.
  const [seen, setSeen] = useState<ReadonlyMap<string, Seen>>(new Map());
  const [sessions, setSessions] = useState<
    ReadonlyMap<string, readonly SessionEntry[]>
  >(new Map());
  const [coding, setCoding] = useState<
    ReadonlyMap<string, readonly CodingSession[]>
  >(new Map());
  const [known, setKnown] = useState<KnownSessions>(new Map());
  // 다시 읽은 목록이 같으면 값을 바꾸지 않는다. 읽기마다(다시 붙음, 구독을 다시 걸 때의 ready) 새 배열이 와서 그대로 넘기면
  // 목록을 쓰는 화면이 구독을 다시 걸고 그 ready가 또 읽기를 부르는 고리가 된다.
  const report = useCallback<Report>((machine, next) => {
    const key = machine ?? "";
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    const keep =
      <T>(entries: T) =>
      (now: ReadonlyMap<string, T>) =>
        same(now.get(key), entries) ? now : new Map(now).set(key, entries);
    if (next.sessions !== undefined) setSessions(keep(next.sessions));
    else if (next.coding !== undefined) setCoding(keep(next.coding));
    else if (next.titles !== undefined) {
      const rows = next.titles;
      setKnown((now) =>
        rows.every((row) =>
          same(now.get(row.id), { title: row.title, at: row.at }),
        )
          ? now
          : new Map([
              ...now,
              ...rows.map(
                (row) => [row.id, { title: row.title, at: row.at }] as const,
              ),
            ]),
      );
    } else {
      setSeen((now) => {
        const was = now.get(key);
        const merged = { ...was, ...next };
        return same(was, merged) ? now : new Map(now).set(key, merged);
      });
    }
  }, []);
  const put = useCallback(
    (session: string, title: string) =>
      setKnown((now) =>
        now.get(session)?.title === title
          ? now
          : new Map(now).set(session, {
              title,
              at: now.get(session)?.at ?? 0,
            }),
      ),
    [],
  );
  const sessionTitles = useMemo(() => ({ known, put }), [known, put]);
  const dataOf = useCallback((machine: MachineRef) => hub.get(machine), [hub]);
  const lists = useMemo(
    (): readonly Omit<MachineSnapshot, "sessions" | "coding">[] =>
      [
        { machine: null, name: "", live: true },
        ...roster.map((one) => ({
          machine: one.id,
          name: one.name,
          live: one.status === "connected",
        })),
      ].map((one) => ({
        ...one,
        projects: seen.get(one.machine ?? "")?.projects ?? [],
        apps: seen.get(one.machine ?? "")?.apps ?? [],
      })),
    [roster, seen],
  );
  const rows = useMemo(() => mergeWorkspaces(lists, homeName), [lists]);
  // `seen`은 내용이 바뀔 때만 바뀌므로 roster나 session이 바뀌어도 이 값은 그대로다.
  const inboxNames = useMemo(
    (): InboxNamesByMachine =>
      new Map(
        [...seen].map(([machine, one]) => [
          machine,
          {
            projects: new Map(
              (one.projects ?? []).map((row) => [row.id, row.title]),
            ),
            apps: new Map((one.apps ?? []).map((row) => [row.id, row.name])),
          },
        ]),
      ),
    [seen],
  );
  const value = useMemo((): MachineListsValue => {
    const snapshots = lists.map(
      (list): MachineSnapshot => ({
        ...list,
        sessions: sessions.get(list.machine ?? "") ?? [],
        coding: coding.get(list.machine ?? "") ?? [],
      }),
    );
    return {
      lists: snapshots,
      rows,
      entries: snapshots.flatMap((list) =>
        list.sessions.map((entry) => ({ ...entry, machine: list.machine })),
      ),
      terminals: snapshots.flatMap(({ machine, coding }) =>
        machine === null ? [] : coding.map((one) => ({ ...one, machine })),
      ),
      sessionTitles,
      offline: new Set(
        snapshots.flatMap((list) =>
          list.live || list.machine === null ? [] : [list.machine],
        ),
      ),
      names: new Map(roster.map((one) => [one.id, one.name])),
      inboxNames,
      dataOf,
    };
  }, [
    lists,
    rows,
    sessions,
    coding,
    sessionTitles,
    roster,
    inboxNames,
    dataOf,
  ]);
  return createElement(
    ListsContext.Provider,
    { value },
    children,
    ...value.lists.map((list) =>
      createElement(MachineScope, {
        key: list.machine ?? "",
        machine: list.machine,
        children: createElement(Reader, {
          machine: list.machine,
          live: list.live,
          report,
        }),
      }),
    ),
  );
}

/**
 * 모든 기계의 session 제목. 탭 줄과 sidebar가 같이 쓴다: 이름을 탭 화면이 그려질 때만 채우면 고르지 않은 탭과 다른 workspace의
 * 줄이 agent 이름으로 떨어진다. 목록이 없는 자리(detached 창, 전역 float)는 자기 범위의 기계 하나를 직접 읽는다.
 */
export function useKnownSessions(
  factory: AgentTabSourceFactory | undefined,
  entries: readonly SessionEntry[],
): SessionTitles {
  const provided = useContext(ListsContext)?.sessionTitles ?? null;
  const own = useSessionTitles(entries, factory, provided === null);
  const [known, setKnown] = useState<KnownSessions>(new Map());
  useEffect(() => {
    if (own.state !== "ready") return;
    setKnown(
      (now) =>
        new Map([
          ...now,
          ...own.value.map(
            (row) => [row.id, { title: row.title, at: row.at }] as const,
          ),
        ]),
    );
  }, [own]);
  const put = useCallback(
    (session: string, title: string) =>
      setKnown((now) =>
        now.get(session)?.title === title
          ? now
          : new Map(now).set(session, {
              title,
              at: now.get(session)?.at ?? 0,
            }),
      ),
    [],
  );
  const alone = useMemo(() => ({ known, put }), [known, put]);
  return provided ?? alone;
}

/**
 * workspace들의 layout에서 읽은 열린 탭. 창의 마지막 값에서 시작한다. 지금 workspace도 들어 있어(떠난 뒤 첫 그림이 쓴다) 부르는 쪽이 layout을 읽은 지금 workspace는 자기 값으로 덮는다.
 * Agent 탭은 파일에 없고 이 창 메모리의 layout(layout-source)에만 있다: 이 창이 연 적 있는 workspace의 Agent 탭만 보이고, 다시 켠 뒤 아직 안 연 workspace는 도는 session과 못 본 turn 끝(상태 점)만 줄이 된다.
 */
export interface TabsElsewhere {
  /** workspace key → session id → Agent 탭 제목. 열렸는지만 쓴다(이름은 session 제목이 정본이다). */
  readonly titles: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** workspace key → 터미널 참조가 있는 터미널 탭. coding agent가 지금 도는지는 그 탭의 기계의 terminal store가 안다. */
  readonly terminals: ReadonlyMap<string, readonly TabItem[]>;
  /** workspace key → 그 workspace layout의 desk. sidebar가 current 줄을 desk로 나눈다. */
  readonly desks: ReadonlyMap<string, LayoutDesks>;
  /** 이 창이 다른 workspace의 layout을 고친 뒤 다시 읽는다. */
  readonly reload: () => void;
}

/**
 * workspace들의 layout에서 열린 Agent 탭과 coding agent 터미널 탭을 읽는다. 지금 workspace도 읽는다: 빼면 workspace를 옮긴 첫 그림에
 * 방금 떠난 workspace의 값이 없어 그 줄이 모두 사라졌다 돌아온다.
 * 창이 다시 포커스를 받거나 session 목록·workspace 목록이 바뀔 때 다시 읽는다.
 */
export function useTabsElsewhere(
  /** 그 workspace의 기계의 layout. */
  layoutOf: (ref: WorkspaceRef) => LayoutSource,
  workspaces: readonly WorkspaceRef[],
  here: WorkspaceRef,
  entries: readonly SessionEntry[],
  /** 이 값이 바뀌면 다시 읽는다(다른 기계의 터미널이 새로 서거나 탭이 생겼다). */
  also: string,
): TabsElsewhere {
  const [titles, setTitles] = useRemembered("elsewhereTitles");
  const [terminals, setTerminals] = useRemembered("elsewhereTerminals");
  const [desks, setDesks] = useRemembered("elsewhereDesks");
  const [focuses, setFocuses] = useState(0);
  useEffect(() => {
    const onFocus = () => setFocuses((count) => count + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const hereKey = workspaceKey(here);
  const ids = entries.map((entry) => entry.session).join();
  useEffect(() => {
    let live = true;
    void Promise.all(
      workspaces.map(async (ref) => {
        const read = await layoutOf(ref).readWorkspaceLayout(ref);
        const titles = new Map<string, string>();
        const terminals: TabItem[] = [];
        const desks =
          read.ok && read.layout !== null ? layoutDesks(read.layout) : null;
        if (read.ok && read.layout !== null) {
          for (const tab of allTabs(read.layout)) {
            const session = tab.kind === "agent" ? sessionOf(tab) : null;
            if (session !== null) titles.set(session, tab.title);
            if (tab.kind === "terminal" && terminalRefOf(tab) !== null) {
              terminals.push(tab);
            }
          }
        }
        return { key: workspaceKey(ref), titles, terminals, desks };
      }),
    ).then((rows) => {
      if (!live) return;
      setTitles(() => new Map(rows.map((row) => [row.key, row.titles])));
      setTerminals(() => new Map(rows.map((row) => [row.key, row.terminals])));
      setDesks(
        () =>
          new Map(
            rows.flatMap((row) =>
              row.desks === null ? [] : [[row.key, row.desks] as const],
            ),
          ),
      );
    });
    return () => {
      live = false;
    };
  }, [
    layoutOf,
    workspaces,
    hereKey,
    ids,
    also,
    focuses,
    setTitles,
    setTerminals,
    setDesks,
  ]);
  const reload = useCallback(() => setFocuses((count) => count + 1), []);
  return useMemo(
    () => ({ titles, terminals, desks, reload }),
    [titles, terminals, desks, reload],
  );
}
