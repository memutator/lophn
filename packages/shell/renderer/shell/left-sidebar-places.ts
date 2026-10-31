// 왼쪽 sidebar의 place별 session 줄을 세운다. 순수 함수라 project 창과 뒤에 Home·app place가 같이 쓴다.
//
// 규칙
// - current: 이 창에 탭이 열린 session, 또는 끝나지 않았고 점이 있는 session(도는 중, 기다리는 중, 못 본 turn 끝).
//   탭이 열렸는지는 이 창이 보이는 place만 안다(`openTitles`).
// - recent: 나머지(끝났거나 닫았거나 가만히 있는). 최근 7일 안에 움직인 것만, 사람이 지운 줄은 그 뒤 움직이기 전까지 뺀다.
//   시각을 모르는 줄(at 0)은 7일 경계로 지우지 않는다.
// - 터미널 coding agent session과 사람 차례인 workflow desk는 이 창이 보이는 place의 것만 온다.
import { t } from "@lophn/i18n";

import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import { harnessVendorOf } from "../parts/vendor-icon/vendor-icon.tsx";
import { sessionDot } from "../workspace/sidebar/panel-sessions.ts";
import type { SidebarAgent } from "../workspace/sidebar/sidebar-agent.ts";
import type { PanelTerminal } from "../workspace/sidebar/panel-types.ts";
import { placeKey, type PlaceRef } from "./desk-model.ts";
import type { SidebarPlace, SidebarSession } from "./left-sidebar-model.ts";

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** session id → 제목과 마지막 활동 시각(epoch ms). agent의 session 목록에서 읽은 것이다. */
export type KnownSessions = ReadonlyMap<
  string,
  { readonly title: string | null; readonly at: number }
>;

/** 사람이 Recent에서 지운 줄의 key → 지운 때(epoch ms). */
export type HiddenRecent = ReadonlyMap<string, number>;

export interface PlacesInput {
  readonly now: number;
  /** 이 창이 보이는 place. */
  readonly current: PlaceRef;
  readonly projects: readonly { readonly id: string; readonly title: string }[];
  readonly apps: readonly { readonly id: string; readonly name: string }[];
  readonly entries: readonly SessionEntry[];
  readonly agents: readonly SidebarAgent[];
  readonly known: KnownSessions;
  /** 이 창에 탭이 열린 session id → 그 탭의 제목. */
  readonly openTitles: ReadonlyMap<string, string>;
  /** 이 창이 보이는 place의 터미널 coding agent session. */
  readonly terminals: readonly PanelTerminal[];
  /** 이 창이 보이는 place에서 사람 차례를 기다리는 workflow 이름. */
  readonly workflows: readonly string[];
  readonly hidden: HiddenRecent;
}

const placeKeyOfEntry = (entry: SessionEntry) =>
  entry.place === null ? "home" : entry.place.id;

function recentVisible(
  key: string,
  at: number,
  hidden: HiddenRecent,
  now: number,
): boolean {
  const hiddenAt = hidden.get(key);
  if (hiddenAt !== undefined && at <= hiddenAt) return false;
  return at === 0 || now - at <= RECENT_WINDOW_MS;
}

export function sidebarPlaces(input: PlacesInput): SidebarPlace[] {
  const here = placeKey(input.current);
  const agents = new Map(
    input.agents.map((agent) => [agent.assignment, agent]),
  );
  const current = new Map<string, SidebarSession[]>();
  const recent = new Map<string, SidebarSession[]>();
  const add = (
    map: Map<string, SidebarSession[]>,
    place: string,
    item: SidebarSession,
  ) => map.set(place, [...(map.get(place) ?? []), item]);

  for (const entry of input.entries) {
    const agent = entry.agent === null ? undefined : agents.get(entry.agent);
    if (agent === undefined || entry.archived) continue;
    const place = placeKeyOfEntry(entry);
    const read = input.known.get(entry.session);
    const tabTitle =
      place === here ? input.openTitles.get(entry.session) : undefined;
    const dot = sessionDot(input.entries, entry.session);
    const item: SidebarSession = {
      kind: "session",
      ref: entry.session,
      title: tabTitle ?? read?.title ?? t("left-sidebar.label.untitled"),
      agent: { kind: "lophn", profile: agent.profile },
      dot,
      at: read?.at ?? 0,
    };
    if (tabTitle !== undefined || (dot !== null && dot !== "ended")) {
      add(current, place, item);
    } else if (recentVisible(entry.session, item.at, input.hidden, input.now)) {
      add(recent, place, item);
    }
  }

  for (const terminal of input.terminals) {
    const item: SidebarSession = {
      kind: "terminal",
      ref: terminal.key,
      title: terminal.title,
      agent: { kind: "coding", vendor: harnessVendorOf(terminal.harness) },
      dot: terminal.dot,
      at: terminal.at,
    };
    if (terminal.live !== null) add(current, here, item);
    else if (recentVisible(terminal.key, item.at, input.hidden, input.now)) {
      add(recent, here, item);
    }
  }

  const byNewest = (a: SidebarSession, b: SidebarSession) => b.at - a.at;
  const place = (ref: PlaceRef, name: string): SidebarPlace => {
    const key = placeKey(ref);
    const waiting: SidebarSession[] =
      key === here
        ? input.workflows.map((workflow) => ({
            kind: "workflow",
            ref: workflow,
            title: workflow,
            agent: { kind: "workflow" },
            dot: "waiting",
            at: 0,
          }))
        : [];
    return {
      ref,
      name,
      current: [...waiting, ...(current.get(key) ?? []).sort(byNewest)],
      recent: (recent.get(key) ?? []).sort(byNewest),
    };
  };

  return [
    place({ kind: "home" }, t("left-sidebar.label.home")),
    ...input.projects.map((item) =>
      place({ kind: "project", id: item.id }, item.title),
    ),
    ...input.apps.map((item) => place({ kind: "app", id: item.id }, item.name)),
  ];
}
