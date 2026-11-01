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
import { allTabs, placeKey, type PlaceRef } from "./desk-model.ts";
import type { LayoutSource } from "./layout-source.ts";
import type { KnownSessions } from "./left-sidebar-places.ts";

/** 보관하지 않은 project와 앱. 순서는 런처와 같다. 등록·생성 뒤에는 reload로 다시 읽는다. */
export function useSidebarPlaceList(
  projects: ProjectsSource | undefined,
  apps: AppsSource | undefined,
): {
  readonly projects: readonly ProjectItem[];
  readonly apps: readonly AppRow[];
  readonly reload: () => void;
} {
  const [projectItems, setProjects] = useState<readonly ProjectItem[]>([]);
  const [appItems, setApps] = useState<readonly AppRow[]>([]);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    void projects?.list().then((read) => {
      if (live && read.ok)
        setProjects(read.value.filter((item) => !item.archived));
    });
    void apps?.list().then((read) => {
      if (live && read.ok) {
        setApps(sortApps(read.value).filter((item) => !item.archived));
      }
    });
    return () => {
      live = false;
    };
  }, [projects, apps, reads]);
  const reload = useCallback(() => setReads((count) => count + 1), []);
  return { projects: projectItems, apps: appItems, reload };
}

/** 모든 place의 session 제목과 마지막 활동 시각. session 목록이 바뀔 때 다시 읽는다. */
export function useKnownSessions(
  factory: AgentTabSourceFactory | undefined,
  entries: readonly SessionEntry[],
): KnownSessions {
  const [known, setKnown] = useState<KnownSessions>(new Map());
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
  }, [factory, pairs, ids]);
  return known;
}

/**
 * 이 창이 보이지 않는 place들의 layout에서 열린 Agent 탭을 읽는다: place key → session id → 탭 제목.
 * 저장된 layout이라 창이 다시 포커스를 받거나 session 목록·place 목록이 바뀔 때 다시 읽는다.
 */
export function useOpenTitlesElsewhere(
  layout: LayoutSource,
  places: readonly PlaceRef[],
  here: PlaceRef,
  entries: readonly SessionEntry[],
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const [titles, setTitles] = useState<
    ReadonlyMap<string, ReadonlyMap<string, string>>
  >(new Map());
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
          const found = new Map<string, string>();
          if (read.ok && read.layout !== null) {
            for (const tab of allTabs(read.layout)) {
              const session = tab.kind === "agent" ? sessionOf(tab) : null;
              if (session !== null) found.set(session, tab.title);
            }
          }
          return [placeKey(ref), found as ReadonlyMap<string, string>] as const;
        }),
    ).then((rows) => {
      if (live) setTitles(new Map(rows));
    });
    return () => {
      live = false;
    };
  }, [layout, places, hereKey, ids, focuses]);
  return titles;
}
