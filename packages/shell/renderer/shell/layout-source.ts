// renderer가 place layout을 읽고 쓰는 통로. main의 `shell:place-layout-*` IPC(preload의 lophnLayout)를 감싸고
// 저장된 snake_case 값과 PlaceLayout을 오간다. tab 값은 kinds registry의 fromStored/toStored가 정한다.
// tab 읽기·쓰기 보조는 옛 workspace/layout-map.ts와 같은 규칙이다(그 파일은 옛 layout을 지울 때 같이 없어진다).
import type {
  PlaceLayoutReadResult,
  PlaceLayoutSaveResult,
} from "../../ipc/workspace.ts";
import { tabKindOf } from "../workspace/kinds/registry.ts";
import {
  type Desk,
  type DetachedItem,
  type FloatRect,
  type FloatTab,
  clampSplitRatio,
  MAIN_DESK,
  type PlaceLayout,
  type PlaceRef,
  placeKey,
  type TabItem,
} from "./desk-model.ts";

// main/workspace/place-layout.ts의 상한과 같다.
const FLOATS_MAX = 20;
const DETACHED_MAX = 20;
const TAB_KEY_MAX = 4096;

export interface PlaceLayoutBridge {
  readPlace(input: { place: string }): Promise<PlaceLayoutReadResult>;
  savePlace(input: {
    place: string;
    layout: unknown;
  }): Promise<PlaceLayoutSaveResult>;
}

/** layout이 null이면 쓸 만한 저장 값이 없다(없음, 손상, 다른 판). 부르는 쪽이 기본 layout을 쓴다. */
export type PlaceLayoutRead =
  | { ok: true; layout: PlaceLayout | null }
  | { ok: false; message: string };

export interface LayoutSource {
  readPlaceLayout(place: PlaceRef): Promise<PlaceLayoutRead>;
  savePlaceLayout(
    place: PlaceRef,
    layout: PlaceLayout,
  ): Promise<{ ok: boolean }>;
}

const globalBridge = (): PlaceLayoutBridge | undefined =>
  (globalThis as { lophnLayout?: PlaceLayoutBridge }).lophnLayout;

export function createLayoutSource(
  bridge: () => PlaceLayoutBridge | undefined = globalBridge,
): LayoutSource {
  return {
    async readPlaceLayout(place) {
      const api = bridge();
      if (api === undefined) {
        return { ok: false, message: "layout is unavailable" };
      }
      try {
        const reply = await api.readPlace({ place: placeKey(place) });
        if (!reply.ok) return { ok: false, message: reply.code };
        return {
          ok: true,
          layout: reply.available ? layoutFromStored(reply.layout) : null,
        };
      } catch {
        return { ok: false, message: "layout is unavailable" };
      }
    },
    async savePlaceLayout(place, layout) {
      const api = bridge();
      if (api === undefined) return { ok: false };
      try {
        const reply = await api.savePlace({
          place: placeKey(place),
          layout: layoutToStored(layout),
        });
        return { ok: reply.ok };
      } catch {
        return { ok: false };
      }
    },
  };
}

/** 메모리에 두는 가짜 통로. dev mock과 gallery가 쓴다. 저장한 값을 JSON으로 거쳐 그대로 돌려준다. initial은 저장하기 전 project·앱 place가 읽는 처음 layout이다(Home은 빈 채로 시작한다). */
export function fakePlaceLayoutBridge(
  initial?: PlaceLayout,
): PlaceLayoutBridge {
  const saved = new Map<string, string>();
  const first =
    initial === undefined ? undefined : JSON.stringify(layoutToStored(initial));
  return {
    readPlace: ({ place }) => {
      const json = saved.get(place) ?? (place === "home" ? undefined : first);
      return Promise.resolve(
        json === undefined
          ? { ok: true, available: false, reason: "absent" }
          : { ok: true, available: true, layout: JSON.parse(json) },
      );
    },
    savePlace: ({ place, layout }) => {
      saved.set(place, JSON.stringify(layout));
      return Promise.resolve({ ok: true });
    },
  };
}

function readPosition(value: unknown): TabItem["readPosition"] {
  if (typeof value !== "object" || value === null) return undefined;
  const section = (value as { section?: unknown }).section;
  const offset = (value as { scroll_offset?: unknown }).scroll_offset;
  if (
    typeof section !== "string" ||
    section.length < 1 ||
    section.length > 128
  ) {
    return undefined;
  }
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
    return undefined;
  }
  return { section, scroll_offset: offset };
}

/** 등록되지 않은 kind거나 맞출 수 없으면 null이다. */
function tabFromStored(value: unknown): TabItem | null {
  if (typeof value !== "object" || value === null) return null;
  const tab = value as Record<string, unknown>;
  const kind = tabKindOf(tab.kind);
  if (
    typeof tab.key !== "string" ||
    tab.key.length === 0 ||
    tab.key.length > TAB_KEY_MAX ||
    kind === undefined
  ) {
    return null;
  }
  return kind.fromStored(tab, {
    key: tab.key,
    position: readPosition(tab.read_position),
  });
}

function tabToStored(tab: TabItem): Record<string, unknown> | null {
  if (tab.transient === true) return null;
  return (
    tabKindOf(tab.kind)?.toStored(tab, {
      position: readPosition(tab.readPosition),
    }) ?? null
  );
}

function rectOf(value: unknown): FloatRect | null {
  const rect = value as Record<string, unknown> | null | undefined;
  if (
    typeof rect !== "object" ||
    rect === null ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)
  ) {
    return null;
  }
  return {
    x: rect.x as number,
    y: rect.y as number,
    width: rect.width as number,
    height: rect.height as number,
  };
}

// tab이 빠졌을 때(알 수 없는 kind, 저장할 수 없는 tab) 고른 tab과 split이 남은 tabs 안에 있게 고친다.
function repaired(desk: Desk): Desk {
  const keys = desk.tabs.map((tab) => tab.key);
  const split = desk.split;
  const at = split === null ? -1 : keys.indexOf(split.a);
  return {
    ...desk,
    selected:
      desk.selected !== null && keys.includes(desk.selected)
        ? desk.selected
        : (keys[0] ?? null),
    split: split !== null && at >= 0 && keys[at + 1] === split.b ? split : null,
  };
}

function compact<T>(items: readonly (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

type Stored = Record<string, unknown>;

function deskFromStored(key: string, value: unknown): Desk | null {
  if (typeof value !== "object" || value === null) return null;
  const desk = value as Stored;
  const list = (field: string): unknown[] =>
    Array.isArray(desk[field]) ? (desk[field] as unknown[]) : [];
  const split = desk.split as Stored | null | undefined;
  return repaired({
    key,
    label: typeof desk.label === "string" ? desk.label : key,
    ...(typeof desk.workflow === "string" ? { workflow: desk.workflow } : {}),
    tabs: compact(list("tabs").map(tabFromStored)),
    selected: typeof desk.selected_tab === "string" ? desk.selected_tab : null,
    split:
      split &&
      typeof split.a === "string" &&
      typeof split.b === "string" &&
      (split.focus === "a" || split.focus === "b")
        ? {
            a: split.a,
            b: split.b,
            focus: split.focus,
            dir: split.dir === "column" ? "column" : "row",
            ratio: clampSplitRatio(
              typeof split.ratio === "number" ? split.ratio : 0.5,
            ),
          }
        : null,
    floats: compact(
      list("floats").map((item): FloatTab | null => {
        const float = item as Stored | null;
        const tab = tabFromStored(float?.tab);
        const rect = rectOf(float?.rect);
        return tab === null || rect === null
          ? null
          : { tab, rect, minimized: float?.minimized === true };
      }),
    ),
    detached: compact(
      list("detached").map((item): DetachedItem | null => {
        const entry = item as Stored | null;
        const tab = tabFromStored(entry?.tab);
        const bounds = rectOf(entry?.bounds);
        return tab === null || bounds === null ? null : { tab, bounds };
      }),
    ),
  });
}

/** 저장된 layout을 읽는다. main이 이미 검증했다. 모양이 틀리거나 Main이 없으면 null이다. */
export function layoutFromStored(value: unknown): PlaceLayout | null {
  const stored = value as { active_desk?: unknown; desks?: unknown } | null;
  if (typeof stored?.desks !== "object" || stored.desks === null) return null;
  const desks: Record<string, Desk> = {};
  for (const [key, desk] of Object.entries(stored.desks)) {
    const read = deskFromStored(key, desk);
    if (read !== null) desks[key] = read;
  }
  if (!Object.hasOwn(desks, MAIN_DESK)) return null;
  return {
    active:
      typeof stored.active_desk === "string" &&
      Object.hasOwn(desks, stored.active_desk)
        ? stored.active_desk
        : MAIN_DESK,
    desks,
  };
}

function deskToStored(input: Desk): Stored {
  const desk = repaired({
    ...input,
    tabs: input.tabs.filter((tab) => tabToStored(tab) !== null),
  });
  return {
    label: desk.label,
    ...(desk.workflow === undefined ? {} : { workflow: desk.workflow }),
    tabs: desk.tabs.map((tab) => tabToStored(tab)),
    selected_tab: desk.selected,
    split: desk.split,
    floats: compact(
      desk.floats.map((item) => {
        const tab = tabToStored(item.tab);
        return tab === null
          ? null
          : { tab, rect: item.rect, minimized: item.minimized };
      }),
    ).slice(0, FLOATS_MAX),
    detached: compact(
      desk.detached.map((item) => {
        const tab = tabToStored(item.tab);
        return tab === null ? null : { tab, bounds: item.bounds };
      }),
    ).slice(0, DETACHED_MAX),
  };
}

/** main에 보내는 값. schema 판은 main이 붙인다. */
export function layoutToStored(layout: PlaceLayout): {
  active_desk: string;
  desks: Record<string, Stored>;
} {
  return {
    active_desk: layout.active,
    desks: Object.fromEntries(
      Object.entries(layout.desks).map(([key, desk]) => [
        key,
        deskToStored(desk),
      ]),
    ),
  };
}
