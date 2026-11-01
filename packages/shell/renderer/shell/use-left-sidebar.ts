// 왼쪽 sidebar가 읽는 값. place 목록(project와 app)과 session의 제목·시각이다.
// session store는 제목과 시각을 싣지 않아 agent × place마다 대화 source의 session 목록에서 읽는다.
import { useCallback, useEffect, useMemo, useState } from "react";

import { sortApps } from "../apps/model.ts";
import type { AppRow, AppsSource } from "../apps/source.ts";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import type {
  ProjectItem,
  ProjectsSource,
} from "../desktop/places/projects/source.ts";
import { sessionOf } from "../workspace/agent/tab-fields.ts";
import { harnessOf } from "../workspace/kinds/terminal.tsx";
import {
  allTabs,
  placeKey,
  type PlaceRef,
  type TabItem,
} from "./desk-model.ts";
import type { LayoutSource } from "./layout-source.ts";
import type { KnownSessions } from "./left-sidebar-places.ts";
import { useRemembered } from "./sidebar-memory.tsx";

/** 보관하지 않은 project와 앱. 순서는 런처와 같다. 등록·생성 뒤에는 reload로 다시 읽는다. */
export function useSidebarPlaceList(
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

/** 모든 place의 session 제목과 마지막 활동 시각. session 목록이 바뀔 때 다시 읽는다. */
export function useKnownSessions(
  factory: AgentTabSourceFactory | undefined,
  entries: readonly SessionEntry[],
): KnownSessions {
  const [known, setKnown] = useRemembered("known");
  // agent × place 쌍. 같은 쌍은 한 번만 읽는다.
  const pairs = useMemo(
    () =>
      [
        ...new Set(
          entries.flatMap((entry) =>
            entry.agent === null
              ? []
              : [
                  `${entry.agent}\0${entry.place?.kind ?? "global"}\0${entry.place?.id ?? ""}`,
                ],
          ),
        ),
      ].sort(),
    [entries],
  );
  const ids = entries.map((entry) => entry.session).join();
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
          place: { kind, id },
        }).sessions();
        return read.ok ? read.value : [];
      }),
    ).then((lists) => {
      if (!live) return;
      setKnown(
        () =>
          new Map(
            lists
              .flat()
              .map((entry) => [
                entry.id,
                { title: entry.title, at: Date.parse(entry.activeAt) || 0 },
              ]),
          ),
      );
    });
    return () => {
      live = false;
    };
  }, [factory, pairs, ids, setKnown]);
  return known;
}

/** 이 창이 보이지 않는 place들의 저장된 layout에서 읽은 열린 탭. 창의 마지막 값에서 시작해 지금 place도 들 수 있어 부르는 쪽이 지금 place를 거른다. */
export interface TabsElsewhere {
  /** place key → session id → Agent 탭 제목. 저장된 Agent 탭은 제목을 남기지 않아 빈 글이다. */
  readonly titles: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** place key → coding agent가 돈 적이 있는 터미널 탭(harness가 저장된 것). 지금 도는지는 창의 terminal store가 안다. */
  readonly terminals: ReadonlyMap<string, readonly TabItem[]>;
}

/**
 * 이 창이 보이지 않는 place들의 layout에서 열린 Agent 탭과 coding agent 터미널 탭을 읽는다.
 * 저장된 layout이라 창이 다시 포커스를 받거나 session 목록·place 목록이 바뀔 때 다시 읽는다.
 */
export function useTabsElsewhere(
  layout: LayoutSource,
  places: readonly PlaceRef[],
  here: PlaceRef,
  entries: readonly SessionEntry[],
): TabsElsewhere {
  const [titles, setTitles] = useRemembered("elsewhereTitles");
  const [terminals, setTerminals] = useRemembered("elsewhereTerminals");
  const [focuses, setFocuses] = useState(0);
  useEffect(() => {
    const onFocus = () => setFocuses((count) => count + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const hereKey = placeKey(here);
  const ids = entries.map((entry) => entry.session).join();
  useEffect(() => {
    let live = true;
    void Promise.all(
      places
        .filter((ref) => placeKey(ref) !== hereKey)
        .map(async (ref) => {
          const read = await layout.readPlaceLayout(ref);
          const titles = new Map<string, string>();
          const terminals: TabItem[] = [];
          if (read.ok && read.layout !== null) {
            for (const tab of allTabs(read.layout)) {
              const session = tab.kind === "agent" ? sessionOf(tab) : null;
              if (session !== null) titles.set(session, tab.title);
              if (tab.kind === "terminal" && harnessOf(tab) !== null) {
                terminals.push(tab);
              }
            }
          }
          return { key: placeKey(ref), titles, terminals };
        }),
    ).then((rows) => {
      if (!live) return;
      setTitles(() => new Map(rows.map((row) => [row.key, row.titles])));
      setTerminals(() => new Map(rows.map((row) => [row.key, row.terminals])));
    });
    return () => {
      live = false;
    };
  }, [layout, places, hereKey, ids, focuses, setTitles, setTerminals]);
  return useMemo(() => ({ titles, terminals }), [titles, terminals]);
}
