// shell의 desk model. place(Home, project, app)마다 desk 여럿이 있고, desk 하나가 tab 줄·split·float·detached를
// 통째로 가진다. 모든 함수는 순수하고 새 값을 돌려준다. 바꿀 수 없으면 같은 참조를 돌려준다.
//
// 불변 조건: desk 안에서 tab key는 tabs·floats·detached를 통틀어 한 번만 나온다. `selected`와 `split.a/b`는
// tabs의 key이고 split의 a, b는 tabs에서 붙어 있다(b가 a 바로 뒤).
import type { Place } from "../../../protocol/lophn-agent/places.ts";
import type {
  DetachedBounds,
  DetachedItem,
  FloatRect,
  TabItem,
} from "../workspace/model.ts";

export type { DetachedBounds, DetachedItem, FloatRect, TabItem };

export type PlaceRef = { kind: "home" } | Place;

/** layout 파일 이름이자 place 구분 key. `home` | project id | app id. */
export function placeKey(ref: PlaceRef): string {
  return ref.kind === "home" ? "home" : ref.id;
}

/** 기본 desk의 key. 옛 layout과 같은 값이고 workflow 이름(slug)과 겹치지 않는다. */
export const MAIN_DESK = "_default";
export const MAIN_LABEL = "Main";

// main/workspace/place-layout.ts의 상한과 같다. 넘기면 저장이 통째로 거절된다.
const FLOATS_MAX = 20;
const DETACHED_MAX = 20;
const DESKS_MAX = 200;

export interface FloatTab {
  readonly tab: TabItem;
  /** minimized여도 접기 전 rect를 지닌다. */
  readonly rect: FloatRect;
  readonly minimized: boolean;
}

export interface Split {
  readonly a: string;
  readonly b: string;
  readonly focus: "a" | "b";
}

export interface Desk {
  readonly key: string;
  readonly label: string;
  /** workflow desk면 workflow 이름. 사람이 만든 desk에는 없다. */
  readonly workflow?: string;
  readonly tabs: readonly TabItem[];
  readonly selected: string | null;
  readonly split: Split | null;
  /** 배열 순서가 위아래 순서다(마지막이 맨 위). */
  readonly floats: readonly FloatTab[];
  readonly detached: readonly DetachedItem[];
}

export interface PlaceLayout {
  readonly active: string;
  readonly desks: Readonly<Record<string, Desk>>;
}

export function emptyDesk(key: string, label: string, workflow?: string): Desk {
  return {
    key,
    label,
    ...(workflow === undefined ? {} : { workflow }),
    tabs: [],
    selected: null,
    split: null,
    floats: [],
    detached: [],
  };
}

export function defaultPlaceLayout(): PlaceLayout {
  return {
    active: MAIN_DESK,
    desks: { [MAIN_DESK]: emptyDesk(MAIN_DESK, MAIN_LABEL) },
  };
}

export type TabWhere = "tab" | "float" | "detached";

/** desk 안에서 key의 자리. 없으면 null. */
export function whereInDesk(desk: Desk, key: string): TabWhere | null {
  if (desk.tabs.some((tab) => tab.key === key)) return "tab";
  if (desk.floats.some((item) => item.tab.key === key)) return "float";
  if (desk.detached.some((item) => item.tab.key === key)) return "detached";
  return null;
}

// tabs에서 key를 뺀다. split 구성원이면 split이 풀리고, 고른 tab이면 짝(없으면 이웃)으로 옮긴다.
function dropTab(desk: Desk, key: string): Desk {
  const at = desk.tabs.findIndex((tab) => tab.key === key);
  if (at < 0) return desk;
  const tabs = desk.tabs.filter((tab) => tab.key !== key);
  const split = desk.split;
  const partner =
    split === null
      ? null
      : split.a === key
        ? split.b
        : split.b === key
          ? split.a
          : null;
  const selected =
    desk.selected === key
      ? (partner ?? tabs[Math.min(at, tabs.length - 1)]?.key ?? null)
      : desk.selected;
  return {
    ...desk,
    tabs,
    selected,
    split: partner === null ? split : null,
  };
}

// tabs 끝에 넣고 고른다.
function appendTab(desk: Desk, tab: TabItem): Desk {
  return { ...desk, tabs: [...desk.tabs, tab], selected: tab.key };
}

/**
 * tab을 연다. 이미 tabs에 있으면 고르기만 한다. float이나 detached에 있으면 그대로 둔다(그 창이 이미 열려 있다).
 */
export function openTab(desk: Desk, tab: TabItem): Desk {
  switch (whereInDesk(desk, tab.key)) {
    case "tab":
      return selectTab(desk, tab.key);
    case "float":
    case "detached":
      return desk;
    case null:
      return appendTab(desk, tab);
  }
}

export function closeTab(desk: Desk, key: string): Desk {
  return dropTab(desk, key);
}

/** tabs의 tab을 고른다. split 구성원이면 focus는 `focus`, 없으면 그 구성원 쪽이다. */
export function selectTab(desk: Desk, key: string, focus?: "a" | "b"): Desk {
  if (!desk.tabs.some((tab) => tab.key === key)) return desk;
  const split = desk.split;
  const side =
    split === null
      ? null
      : (focus ??
        (split.a === key ? "a" : split.b === key ? "b" : split.focus));
  const next = split === null ? null : { ...split, focus: side! };
  if (
    desk.selected === key &&
    (split === null || next!.focus === split.focus)
  ) {
    return desk;
  }
  return { ...desk, selected: key, split: next };
}

/**
 * key를 tabs 안의 toIndex로 옮긴다(옮긴 뒤의 index). split 구성원이면 짝과 함께 a가 앞서게 옮기고,
 * split 둘 사이로는 들어가지 못한다.
 */
export function moveTab(desk: Desk, key: string, toIndex: number): Desk {
  const from = desk.tabs.findIndex((tab) => tab.key === key);
  if (from < 0) return desk;
  const split = desk.split;
  const member = split !== null && (split.a === key || split.b === key);
  const moving = member
    ? desk.tabs.filter((tab) => tab.key === split.a || tab.key === split.b)
    : [desk.tabs[from]!];
  const rest = desk.tabs.filter((tab) => !moving.includes(tab));
  let at = member && split.b === key ? toIndex - 1 : toIndex;
  if (!member && split !== null) {
    const pairAt = rest.findIndex((tab) => tab.key === split.a);
    // 두 tab 사이로 떨어지면 움직인 방향의 바깥으로 비킨다.
    if (at === pairAt + 1) at = from < pairAt ? pairAt + 2 : pairAt;
  }
  at = Math.max(0, Math.min(at, rest.length));
  const tabs = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return tabs.every((tab, index) => tab === desk.tabs[index])
    ? desk
    : { ...desk, tabs };
}

/** tabs의 두 tab을 split 하나로 붙인다. b를 a 바로 뒤로 옮기고 a를 고른다. 이미 있던 split은 풀린다. */
export function splitWith(desk: Desk, a: string, b: string): Desk {
  const tabB = desk.tabs.find((tab) => tab.key === b);
  if (a === b || tabB === undefined) return desk;
  if (!desk.tabs.some((tab) => tab.key === a)) return desk;
  const rest = desk.tabs.filter((tab) => tab.key !== b);
  const at = rest.findIndex((tab) => tab.key === a) + 1;
  return {
    ...desk,
    tabs: [...rest.slice(0, at), tabB, ...rest.slice(at)],
    selected: a,
    split: { a, b, focus: "a" },
  };
}

export function unsplit(desk: Desk): Desk {
  return desk.split === null ? desk : { ...desk, split: null };
}

/** tabs의 tab을 떠 있는 패널로 만든다(맨 위). 상한이면 그대로다. */
export function floatTab(desk: Desk, key: string, rect: FloatRect): Desk {
  const found = desk.tabs.find((tab) => tab.key === key);
  if (found === undefined || desk.floats.length >= FLOATS_MAX) return desk;
  const dropped = dropTab(desk, key);
  return {
    ...dropped,
    floats: [...dropped.floats, { tab: found, rect, minimized: false }],
  };
}

function changeFloat(
  desk: Desk,
  key: string,
  change: (item: FloatTab) => FloatTab,
): Desk {
  const at = desk.floats.findIndex((item) => item.tab.key === key);
  if (at < 0) return desk;
  const item = desk.floats[at]!;
  const next = change(item);
  if (next === item) return desk;
  return {
    ...desk,
    floats: desk.floats.map((float, index) => (index === at ? next : float)),
  };
}

export function minimizeFloat(desk: Desk, key: string): Desk {
  return changeFloat(desk, key, (item) =>
    item.minimized ? item : { ...item, minimized: true },
  );
}

/** 접힘을 풀고 맨 위로 올린다. */
export function restoreFloat(desk: Desk, key: string): Desk {
  const item = desk.floats.find((float) => float.tab.key === key);
  if (item === undefined) return desk;
  const top = desk.floats[desk.floats.length - 1] === item;
  if (!item.minimized && top) return desk;
  return {
    ...desk,
    floats: [
      ...desk.floats.filter((float) => float !== item),
      { ...item, minimized: false },
    ],
  };
}

export function setFloatRect(desk: Desk, key: string, rect: FloatRect): Desk {
  return changeFloat(desk, key, (item) => ({ ...item, rect }));
}

/** 떠 있는 패널을 tabs 끝에 넣고 고른다. */
export function dockFloat(desk: Desk, key: string): Desk {
  const item = desk.floats.find((float) => float.tab.key === key);
  if (item === undefined) return desk;
  return appendTab(closeFloat(desk, key), item.tab);
}

export function closeFloat(desk: Desk, key: string): Desk {
  if (!desk.floats.some((item) => item.tab.key === key)) return desk;
  return {
    ...desk,
    floats: desk.floats.filter((item) => item.tab.key !== key),
  };
}

/** tabs나 floats의 tab을 OS 창으로 뗀다. 상한이면 그대로다. */
export function detachTab(
  desk: Desk,
  key: string,
  bounds: DetachedBounds,
): Desk {
  if (desk.detached.length >= DETACHED_MAX) return desk;
  const inTabs = desk.tabs.find((tab) => tab.key === key);
  const inFloat = desk.floats.find((item) => item.tab.key === key);
  const tab = inTabs ?? inFloat?.tab;
  if (tab === undefined) return desk;
  const removed =
    inTabs === undefined ? closeFloat(desk, key) : dropTab(desk, key);
  return { ...removed, detached: [...removed.detached, { tab, bounds }] };
}

/** detached tab을 tabs 끝에 넣고 고른다. `tab`을 주면 창 안에서 바뀐 그 값으로 바꿔 붙인다. */
export function reattachTab(desk: Desk, key: string, tab?: TabItem): Desk {
  const item = desk.detached.find((entry) => entry.tab.key === key);
  if (item === undefined) return desk;
  return appendTab(closeDetached(desk, key), tab ?? item.tab);
}

export function closeDetached(desk: Desk, key: string): Desk {
  if (!desk.detached.some((item) => item.tab.key === key)) return desk;
  return {
    ...desk,
    detached: desk.detached.filter((item) => item.tab.key !== key),
  };
}

// layout 층

/** desk 하나만 바꾼다. 없는 desk거나 같은 값이면 같은 참조다. */
export function updateDesk(
  layout: PlaceLayout,
  key: string,
  change: (desk: Desk) => Desk,
): PlaceLayout {
  const desk = layout.desks[key];
  if (desk === undefined) return layout;
  const next = change(desk);
  if (next === desk) return layout;
  return { ...layout, desks: { ...layout.desks, [key]: next } };
}

export function activeDesk(layout: PlaceLayout): Desk {
  return layout.desks[layout.active]!;
}

/** 새 desk를 더한다. key는 부르는 쪽이 정한다(id 주입). 있는 key거나 상한이면 그대로다. */
export function addDesk(
  layout: PlaceLayout,
  key: string,
  label: string,
  workflow?: string,
): PlaceLayout {
  if (
    Object.hasOwn(layout.desks, key) ||
    Object.keys(layout.desks).length >= DESKS_MAX
  ) {
    return layout;
  }
  return {
    ...layout,
    desks: { ...layout.desks, [key]: emptyDesk(key, label, workflow) },
  };
}

export function renameDesk(
  layout: PlaceLayout,
  key: string,
  label: string,
): PlaceLayout {
  const name = label.trim();
  if (name.length === 0) return layout;
  return updateDesk(layout, key, (desk) =>
    desk.label === name ? desk : { ...desk, label: name },
  );
}

export function setActiveDesk(layout: PlaceLayout, key: string): PlaceLayout {
  if (!Object.hasOwn(layout.desks, key) || layout.active === key) return layout;
  return { ...layout, active: key };
}

/**
 * desk를 지운다. Main은 지우지 못한다. 지운 desk의 tab·float·detached는 Main으로 옮긴다: tabs는 끝에 붙고,
 * float·detached는 상한이 남아 있을 때만 그대로 가며 아니면 tab으로 간다. Main에 이미 같은 key가 있으면 옮기지 않는다.
 */
export function removeDesk(layout: PlaceLayout, key: string): PlaceLayout {
  const gone = layout.desks[key];
  if (key === MAIN_DESK || gone === undefined) return layout;
  let main = layout.desks[MAIN_DESK]!;
  const fresh = (tab: TabItem) => whereInDesk(main, tab.key) === null;
  for (const tab of gone.tabs) {
    if (fresh(tab)) main = { ...main, tabs: [...main.tabs, tab] };
  }
  for (const item of gone.floats) {
    if (!fresh(item.tab)) continue;
    main =
      main.floats.length < FLOATS_MAX
        ? { ...main, floats: [...main.floats, item] }
        : { ...main, tabs: [...main.tabs, item.tab] };
  }
  for (const item of gone.detached) {
    if (!fresh(item.tab)) continue;
    main =
      main.detached.length < DETACHED_MAX
        ? { ...main, detached: [...main.detached, item] }
        : { ...main, tabs: [...main.tabs, item.tab] };
  }
  if (main.selected === null && main.tabs.length > 0) {
    main = { ...main, selected: main.tabs[0]!.key };
  }
  const rest = Object.fromEntries(
    Object.entries(layout.desks).filter(([name]) => name !== key),
  );
  return {
    active: layout.active === key ? MAIN_DESK : layout.active,
    desks: { ...rest, [MAIN_DESK]: main },
  };
}

/** layout 전체에서 key의 tab이 있는 desk와 자리. session 열기가 그 desk로 가는 데 쓴다. active desk를 먼저 본다. */
export function findTab(
  layout: PlaceLayout,
  key: string,
): { desk: string; where: TabWhere } | null {
  const order = [
    layout.active,
    ...Object.keys(layout.desks).filter((name) => name !== layout.active),
  ];
  for (const name of order) {
    const where = whereInDesk(layout.desks[name]!, key);
    if (where !== null) return { desk: name, where };
  }
  return null;
}

/** 이미 열린 desk로 가서 열고, 어디에도 없으면 지금 desk에 연다. */
export function openTabInLayout(
  layout: PlaceLayout,
  tab: TabItem,
): PlaceLayout {
  const at = findTab(layout, tab.key)?.desk ?? layout.active;
  return updateDesk(setActiveDesk(layout, at), at, (desk) =>
    openTab(desk, tab),
  );
}
