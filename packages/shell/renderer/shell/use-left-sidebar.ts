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
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import { useMachines, useMachinesView } from "../desktop/machines/context.tsx";
import type { MachineData, OnMachine } from "../desktop/machines/data.ts";
import {
  MachineScope,
  type MachineRef,
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
import { harnessOf } from "../workspace/kinds/terminal.tsx";
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
}

export interface MachineListsValue {
  /** 창의 기계(null, 이 컴퓨터)가 맨 앞이고 그 뒤가 명단 순서다. */
  readonly lists: readonly MachineSnapshot[];
  readonly rows: readonly MergedWorkspace[];
  readonly entries: readonly OnMachine<SessionEntry>[];
  /** 꺼진 기계. */
  readonly offline: ReadonlySet<string>;
  /** 기계 id → 명단의 이름. */
  readonly names: ReadonlyMap<string, string>;
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

type Seen = Partial<Pick<MachineSnapshot, "projects" | "apps" | "sessions">>;

// 기계 하나의 project·앱·session을 그 기계의 범위에서 읽어 올린다. 꺼진 기계의 session store는 비거나 낡으므로 붙어 있을 때 본
// 것만 올린다.
function Reader({
  machine,
  live,
  report,
}: {
  machine: MachineRef;
  live: boolean;
  report: (machine: MachineRef, seen: Seen) => void;
}) {
  const projects = useCoreRead(projectApi.list, ALL).loaded;
  const apps = useAppList().loaded;
  const { sessions } = useSessions();
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
  return null;
}

/**
 * 창이 사는 동안 모든 기계의 목록을 읽어 들고 있다(workspace를 옮겨도 다시 읽지 않는다). 꺼진 기계는 이 실행 동안 마지막으로 본
 * 목록을 남긴다(저장하지 않는다). 기계에 묶인 창(그 기계만 보는 창)은 그 기계 하나만 읽는다.
 */
export function MachineListsProvider({ children }: { children: ReactNode }) {
  const source = useMachines();
  const view = useMachinesView();
  const hub = useMachineHub();
  if (hub === null) throw new Error("MachineHubProvider is missing");
  // 창의 기계. 줄과 ref에서 기계가 없으면 이 기계다.
  const root = source?.thisWindow()?.id ?? null;
  const roster = useMemo(
    () =>
      root !== null
        ? []
        : (view?.machines ?? []).filter((one) => one.status !== "removed"),
    [root, view],
  );
  // 목록(project·앱)과 session을 따로 든다: session은 자주 바뀌고 줄(rows)은 목록만으로 짓는다.
  const [seen, setSeen] = useState<ReadonlyMap<string, Seen>>(new Map());
  const [sessions, setSessions] = useState<
    ReadonlyMap<string, readonly SessionEntry[]>
  >(new Map());
  const report = useCallback((machine: MachineRef, next: Seen) => {
    const key = machine ?? "";
    if (next.sessions !== undefined) {
      const entries = next.sessions;
      setSessions((now) => new Map(now).set(key, entries));
    } else
      setSeen((now) => new Map(now).set(key, { ...now.get(key), ...next }));
  }, []);
  const dataOf = useCallback(
    (machine: MachineRef) => hub.get(machine ?? root),
    [hub, root],
  );
  const lists = useMemo(
    (): readonly Omit<MachineSnapshot, "sessions">[] =>
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
  const value = useMemo((): MachineListsValue => {
    const snapshots = lists.map(
      (list): MachineSnapshot => ({
        ...list,
        sessions: sessions.get(list.machine ?? "") ?? [],
      }),
    );
    return {
      lists: snapshots,
      rows,
      entries: snapshots.flatMap((list) =>
        list.sessions.map((entry) => ({ ...entry, machine: list.machine })),
      ),
      offline: new Set(
        snapshots.flatMap((list) =>
          list.live || list.machine === null ? [] : [list.machine],
        ),
      ),
      names: new Map(roster.map((one) => [one.id, one.name])),
      dataOf,
    };
  }, [lists, rows, sessions, roster, dataOf]);
  return createElement(
    ListsContext.Provider,
    { value },
    children,
    ...value.lists.map((list) =>
      createElement(MachineScope, {
        key: list.machine ?? "",
        machine: list.machine ?? root,
        children: createElement(Reader, {
          machine: list.machine,
          live: list.live,
          report,
        }),
      }),
    ),
  );
}

export interface SessionTitles {
  readonly known: KnownSessions;
  /** 화면이 먼저 안 제목(열린 대화가 읽은 것, 방금 바꾼 이름)을 넣는다. 탭 줄과 sidebar가 바로 따라간다. */
  readonly put: (session: string, title: string) => void;
}

// 쌍 key에서 이 컴퓨터(`machine`이 null인 줄). 기계 id(`mch_`)와 겹치지 않는다.
const HERE = "here";

type TitleRow = {
  readonly id: string;
  readonly title: string | null;
  readonly at: number;
};

/**
 * 모든 workspace의 session 제목과 마지막 활동 시각. 창에 하나이고 탭 줄과 sidebar가 같이 쓴다: 이름을 탭 화면이
 * 그려질 때만 채우면 고르지 않은 탭과 다른 workspace의 줄이 agent 이름으로 떨어진다.
 * 이름 바꾸기(다른 창의 것도)는 `sessions` 변경으로 다시 읽는다. 자동 제목은 변경을 내지 않아 session 줄이 바뀔 때(`sessionTitlesKey`) 다시 읽는다.
 */
export function useKnownSessions(
  factory: AgentTabSourceFactory | undefined,
  entries: readonly (SessionEntry & { readonly machine?: MachineRef })[],
  /** `machine`이 있는 줄의 통로. 그 기계의 agent로 읽는다. */
  factoryOf?: (machine: MachineRef) => AgentTabSourceFactory | undefined,
): SessionTitles {
  const [known, setKnown] = useRemembered("known");
  // 기계 × agent × workspace 쌍. 같은 쌍은 한 번만 읽는다. 기계마다 같은 agent id(`lophn_home`, `lophn_<app id>`)가 있어 기계를 앞에 둔다.
  const pairs = useMemo(
    () =>
      [
        ...new Set(
          entries.flatMap((entry) =>
            entry.agent === null
              ? []
              : [
                  `${entry.machine === undefined ? "" : (entry.machine ?? HERE)}\0${entry.agent}\0${entry.workspace?.kind ?? "global"}\0${entry.workspace?.id ?? ""}`,
                ],
          ),
        ),
      ].sort(),
    [entries],
  );
  // 쌍마다 그 agent의 session 목록(page를 끝까지)이라 route 하나로 끝나지 않는다.
  const titles = useFollowedRead(
    async () => {
      const lists = await Promise.all(
        pairs.map(async (pair) => {
          const [machine, assignment, kind, id] = pair.split("\0") as [
            string,
            string,
            "global" | "project" | "app",
            string,
          ];
          const from =
            machine === ""
              ? factory
              : factoryOf?.(machine === HERE ? null : machine);
          if (from === undefined) return [];
          const read = await from({
            assignment,
            workspace: { kind, id },
          }).sessions();
          return read.ok ? read.value : [];
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
    `${pairs.join()}|${sessionTitlesKey(entries)}`,
  ).loaded;
  useEffect(() => {
    if (titles.state !== "ready") return;
    // 못 읽은 쌍(실패는 빈 목록으로 온다)이 그 session들의 제목을 지우지 않게 이어 쓴다. 지운 session은 entries에 없어 줄이 되지 않는다.
    setKnown(
      (now) =>
        new Map([
          ...now,
          ...titles.value.map(
            (row) => [row.id, { title: row.title, at: row.at }] as const,
          ),
        ]),
    );
  }, [titles, setKnown]);
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
    [setKnown],
  );
  return useMemo(() => ({ known, put }), [known, put]);
}

/**
 * workspace들의 layout에서 읽은 열린 탭. 창의 마지막 값에서 시작한다. 지금 workspace도 들어 있어(떠난 뒤 첫 그림이 쓴다) 부르는 쪽이 layout을 읽은 지금 workspace는 자기 값으로 덮는다.
 * Agent 탭은 파일에 없고 이 창 메모리의 layout(layout-source)에만 있다: 이 창이 연 적 있는 workspace의 Agent 탭만 보이고, 다시 켠 뒤 아직 안 연 workspace는 도는 session과 못 본 turn 끝(상태 점)만 줄이 된다.
 */
export interface TabsElsewhere {
  /** workspace key → session id → Agent 탭 제목. 열렸는지만 쓴다(이름은 session 제목이 정본이다). */
  readonly titles: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** workspace key → coding agent가 돈 적이 있는 터미널 탭(harness가 저장된 것). 지금 도는지는 창의 terminal store가 안다. */
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
            if (tab.kind === "terminal" && harnessOf(tab) !== null) {
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
