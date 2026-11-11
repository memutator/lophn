// 왼쪽 sidebar가 읽는 값. workspace 목록(project와 app)과 session의 제목·시각이다.
// session store는 제목과 시각을 싣지 않아 agent × workspace마다 대화 source의 session 목록에서 읽는다.
import { useCallback, useEffect, useMemo, useState } from "react";

import { sortApps } from "../apps/model.ts";
import type { AppRow, AppsSource } from "../apps/source.ts";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import type {
  ProjectItem,
  ProjectsSource,
} from "../desktop/workspaces/projects/source.ts";
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
  type KnownSessions,
  type LayoutDesks,
  layoutDesks,
} from "./left-sidebar-workspaces.ts";
import { sessionTitlesKey } from "./session-titles.ts";
import { useRemembered } from "./sidebar-memory.tsx";

/** 보관하지 않은 project와 앱. 순서는 런처와 같다. 등록·생성 뒤에는 reload로 다시 읽는다. */
export function useSidebarWorkspaceList(
  projects: ProjectsSource | undefined,
  apps: AppsSource | undefined,
): {
  readonly projects: readonly ProjectItem[];
  readonly apps: readonly AppRow[];
  readonly reload: () => void;
} {
  const [projectItems, setProjects] = useRemembered("projects");
  const [appItems, setApps] = useRemembered("apps");
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    void projects?.list().then((read) => {
      if (live && read.ok) {
        setProjects(() => read.value.filter((item) => !item.archived));
      }
    });
    void apps?.list().then((read) => {
      if (live && read.ok) {
        setApps(() => sortApps(read.value).filter((item) => !item.archived));
      }
    });
    return () => {
      live = false;
    };
  }, [projects, apps, reads, setProjects, setApps]);
  const reload = useCallback(() => setReads((count) => count + 1), []);
  return { projects: projectItems, apps: appItems, reload };
}

export interface SessionTitles {
  readonly known: KnownSessions;
  /** 제목만 바뀐 것(Rename)은 event가 없어 부르는 쪽이 다시 읽게 한다. */
  readonly reload: () => void;
  /** 화면이 먼저 안 제목(열린 대화가 읽은 것, 방금 바꾼 이름)을 넣는다. 탭 줄과 sidebar가 바로 따라간다. */
  readonly put: (session: string, title: string) => void;
}

/**
 * 모든 workspace의 session 제목과 마지막 활동 시각. 창에 하나이고 탭 줄과 sidebar가 같이 쓴다: 이름을 탭 화면이
 * 그려질 때만 채우면 고르지 않은 탭과 다른 workspace의 줄이 agent 이름으로 떨어진다.
 */
export function useKnownSessions(
  factory: AgentTabSourceFactory | undefined,
  entries: readonly SessionEntry[],
): SessionTitles {
  const [known, setKnown] = useRemembered("known");
  const [reads, setReads] = useState(0);
  // agent × workspace 쌍. 같은 쌍은 한 번만 읽는다.
  const pairs = useMemo(
    () =>
      [
        ...new Set(
          entries.flatMap((entry) =>
            entry.agent === null
              ? []
              : [
                  `${entry.agent}\0${entry.workspace?.kind ?? "global"}\0${entry.workspace?.id ?? ""}`,
                ],
          ),
        ),
      ].sort(),
    [entries],
  );
  const key = sessionTitlesKey(entries);
  // 다른 창에서 바꾼 이름은 이 창에 event가 없다. 창이 다시 포커스를 받을 때 읽는다.
  useEffect(() => {
    const onFocus = () => setReads((count) => count + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (factory === undefined) return;
    let live = true;
    void Promise.all(
      pairs.map(async (pair) => {
        const [assignment, kind, id] = pair.split("\0") as [
          string,
          "global" | "project" | "app",
          string,
        ];
        const read = await factory({
          assignment,
          workspace: { kind, id },
        }).sessions();
        return read.ok ? read.value : [];
      }),
    ).then((lists) => {
      if (!live) return;
      // 못 읽은 쌍(실패는 빈 목록으로 온다)이 그 session들의 제목을 지우지 않게 이어 쓴다. 지운 session은 entries에 없어 줄이 되지 않는다.
      setKnown(
        (now) =>
          new Map([
            ...now,
            ...lists.flat().map(
              (entry) =>
                [
                  entry.id,
                  {
                    title: entry.title,
                    at: Date.parse(entry.activeAt) || 0,
                  },
                ] as const,
            ),
          ]),
      );
    });
    return () => {
      live = false;
    };
  }, [factory, pairs, key, reads, setKnown]);
  const reload = useCallback(() => setReads((count) => count + 1), []);
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
  return useMemo(() => ({ known, reload, put }), [known, reload, put]);
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
  layout: LayoutSource,
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
        const read = await layout.readWorkspaceLayout(ref);
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
    layout,
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
