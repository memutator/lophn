// shell의 desk model. place(Home, project, app)마다 desk 여럿이 있고, desk 하나가 tab 줄·group·float·detached를
// 통째로 가진다. 모든 함수는 순수하고 새 값을 돌려준다. 바꿀 수 없으면 같은 참조를 돌려준다.
//
// 불변 조건: desk 안에서 tab key는 tabs·floats·detached를 통틀어 한 번만 나온다. `selected`는 tabs의 key다.
// group은 tabs의 tab 2~4개를 한 칸으로 묶은 값이다. leaf key는 모두 tabs에 있고 tab은 group 하나에만 들며,
// group의 tab은 tabs에서 leaf 순서(왼쪽·위에서부터)로 붙어 있다. 1개로 줄면 group은 풀린다. `selected`가 group
// 구성원이면 그 group의 `focus`가 selected다. 모든 변경은 끝에 `settle`을 거쳐 이를 맞춘다.
import type { Place } from "../../../protocol/lophn-agent/places.ts";
import {
  clampFloatRect,
  type DetachedBounds,
  type DetachedItem,
  type FloatArea,
  type FloatRect,
  type TabItem,
} from "../workspace/model.ts";

export type { DetachedBounds, DetachedItem, FloatArea, FloatRect, TabItem };

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

export type SplitDir = "row" | "column";

/** row는 좌우, column은 위아래. ratio는 a가 차지하는 몫이다. */
export const SPLIT_RATIO_MIN = 0.15;
export const SPLIT_RATIO_MAX = 0.85;

/** group 하나의 leaf 수 범위. */
export const GROUP_MIN = 2;
export const GROUP_MAX = 4;

/** group의 배치 tree. leaf는 tab key이고 나눔은 row(a가 왼쪽)나 column(a가 위)이다. */
export type GroupNode =
  | { readonly tab: string }
  | {
      readonly dir: SplitDir;
      readonly ratio: number;
      readonly a: GroupNode;
      readonly b: GroupNode;
    };

/** 나눔 node까지 가는 길. a 또는 b를 차례로 고른다. 빈 길이 root다. */
export type NodePath = readonly ("a" | "b")[];

/** `focus`는 leaf 하나의 tab key다. */
export interface Group {
  readonly layout: GroupNode;
  readonly focus: string;
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

export interface Desk {
  readonly key: string;
  readonly label: string;
  /** workflow desk면 workflow 이름. 사람이 만든 desk에는 없다. */
  readonly workflow?: string;
  readonly tabs: readonly TabItem[];
  readonly selected: string | null;
  readonly groups: readonly Group[];
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
    groups: [],
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

// group tree 보조

const isLeaf = (node: GroupNode): node is { readonly tab: string } =>
  "tab" in node;

/** group tree의 leaf key를 왼쪽·위에서부터 차례로. */
export function leavesOf(node: GroupNode): string[] {
  return isLeaf(node) ? [node.tab] : [...leavesOf(node.a), ...leavesOf(node.b)];
}

/** 두 leaf 사이마다 놓이는 나눔 방향(leaf 순서). 줄의 반쪽 사이 표시가 쓴다. */
export function dirsOf(node: GroupNode): SplitDir[] {
  return isLeaf(node) ? [] : [...dirsOf(node.a), node.dir, ...dirsOf(node.b)];
}

/** group의 key. 첫 leaf이고 tab 줄에서 한 칸의 key다. */
export function groupKey(group: Group): string {
  return leavesOf(group.layout)[0]!;
}

/** key의 tab이 든 group. 없으면 null. */
export function groupOf(desk: Desk, key: string | null): Group | null {
  if (key === null) return null;
  return (
    desk.groups.find((group) => leavesOf(group.layout).includes(key)) ?? null
  );
}

// leaf 하나를 지운다. 짝은 부모 자리로 올라온다. 모두 지워지면 null.
function removeLeaf(node: GroupNode, key: string): GroupNode | null {
  if (isLeaf(node)) return node.tab === key ? null : node;
  const a = removeLeaf(node.a, key);
  const b = removeLeaf(node.b, key);
  if (a === null) return b;
  if (b === null) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function replaceLeaf(
  node: GroupNode,
  key: string,
  by: (leaf: GroupNode) => GroupNode,
): GroupNode {
  if (isLeaf(node)) return node.tab === key ? by(node) : node;
  return {
    ...node,
    a: replaceLeaf(node.a, key, by),
    b: replaceLeaf(node.b, key, by),
  };
}

// 이름 바꾸기와 swap. map에 없는 key는 그대로다.
function renameLeaves(
  node: GroupNode,
  rename: (key: string) => string,
): GroupNode {
  if (isLeaf(node)) {
    const next = rename(node.tab);
    return next === node.tab ? node : { tab: next };
  }
  return {
    ...node,
    a: renameLeaves(node.a, rename),
    b: renameLeaves(node.b, rename),
  };
}

function renameInGroup(group: Group, rename: (key: string) => string): Group {
  return {
    layout: renameLeaves(group.layout, rename),
    focus: rename(group.focus),
  };
}

/** 나눔 node의 몫을 정한다. path 끝이 나눔이 아니면 그대로다. 범위 밖이면 가장자리로 당긴다. */
export function setNodeRatio(
  node: GroupNode,
  path: NodePath,
  ratio: number,
): GroupNode {
  if (isLeaf(node)) return node;
  const [head, ...rest] = path;
  if (head === undefined) {
    const next = clampSplitRatio(ratio);
    return next === node.ratio ? node : { ...node, ratio: next };
  }
  const child = setNodeRatio(node[head], rest, ratio);
  return child === node[head] ? node : { ...node, [head]: child };
}

// 모든 변경의 끝에서 group 불변 조건을 맞춘다: tabs에 없거나 다른 group에 이미 든 leaf를 빼고, 1개로 줄면 풀고,
// focus가 leaf가 아니면 첫 leaf로, selected가 구성원이면 selected로 맞추고, group의 tab을 첫 구성원 자리에 leaf
// 순서로 붙인다. 바뀐 것이 없으면 같은 참조다.
function settle(desk: Desk): Desk {
  const inTabs = new Set(desk.tabs.map((tab) => tab.key));
  const used = new Set<string>();
  const groups: Group[] = [];
  for (const group of desk.groups) {
    let layout: GroupNode | null = group.layout;
    for (const key of leavesOf(group.layout)) {
      if (!inTabs.has(key) || used.has(key)) {
        layout = layout === null ? null : removeLeaf(layout, key);
      }
    }
    if (layout === null) continue;
    const leaves = leavesOf(layout);
    if (leaves.length < GROUP_MIN) continue;
    for (const key of leaves) used.add(key);
    const focus =
      desk.selected !== null && leaves.includes(desk.selected)
        ? desk.selected
        : leaves.includes(group.focus)
          ? group.focus
          : leaves[0]!;
    groups.push(
      layout === group.layout && focus === group.focus
        ? group
        : { layout, focus },
    );
  }
  const owner = new Map<string, Group>();
  for (const group of groups) {
    for (const key of leavesOf(group.layout)) owner.set(key, group);
  }
  const byKey = new Map(desk.tabs.map((tab) => [tab.key, tab]));
  const emitted = new Set<Group>();
  const tabs: TabItem[] = [];
  for (const tab of desk.tabs) {
    const group = owner.get(tab.key);
    if (group === undefined) {
      tabs.push(tab);
    } else if (!emitted.has(group)) {
      emitted.add(group);
      for (const key of leavesOf(group.layout)) tabs.push(byKey.get(key)!);
    }
  }
  const sameTabs = tabs.every((tab, index) => tab === desk.tabs[index]);
  const sameGroups =
    groups.length === desk.groups.length &&
    groups.every((group, index) => group === desk.groups[index]);
  if (sameTabs && sameGroups) return desk;
  return {
    ...desk,
    tabs: sameTabs ? desk.tabs : tabs,
    groups: sameGroups ? desk.groups : groups,
  };
}

/** tab 줄의 한 칸. group이면 구성원 tab이 leaf 순서로 든다. */
export interface DeskEntry {
  /** 칸의 key. 첫 tab의 key다. */
  readonly key: string;
  readonly tabs: readonly TabItem[];
  readonly group: Group | null;
}

export function deskEntries(desk: Desk): DeskEntry[] {
  const entries: DeskEntry[] = [];
  const seen = new Set<Group>();
  for (const tab of desk.tabs) {
    const group = groupOf(desk, tab.key);
    if (group === null) {
      entries.push({ key: tab.key, tabs: [tab], group: null });
    } else if (!seen.has(group)) {
      seen.add(group);
      const members = leavesOf(group.layout).map(
        (key) => desk.tabs.find((item) => item.key === key)!,
      );
      entries.push({ key: members[0]!.key, tabs: members, group });
    }
  }
  return entries;
}

// tabs에서 key를 뺀다. group 구성원이면 group에서도 빠지고(1개로 줄면 풀린다), 고른 tab이면 group의 이웃
// leaf(없으면 tabs의 이웃)로 옮긴다.
function dropTab(desk: Desk, key: string): Desk {
  const at = desk.tabs.findIndex((tab) => tab.key === key);
  if (at < 0) return desk;
  const tabs = desk.tabs.filter((tab) => tab.key !== key);
  let selected = desk.selected;
  if (selected === key) {
    const group = groupOf(desk, key);
    const leaves = group === null ? [] : leavesOf(group.layout);
    const own = leaves.indexOf(key);
    selected =
      leaves[own + 1] ??
      leaves[own - 1] ??
      tabs[Math.min(at, tabs.length - 1)]?.key ??
      null;
  }
  return settle({ ...desk, tabs, selected });
}

// popup 같은 잠깐 tab 표시와 preview는 tabs로 돌아오는 순간 지운다(다시 열면 모두 고정 tab).
function settled(tab: TabItem): TabItem {
  const { transient: _transient, ...rest } = tab;
  return { ...rest, preview: false };
}

// tabs 끝에 넣고 고른다.
function appendTab(desk: Desk, tab: TabItem): Desk {
  return { ...desk, tabs: [...desk.tabs, settled(tab)], selected: tab.key };
}

/** preview tab을 고정 tab으로 만든다(tab double-click, 내용을 고침). */
export function pinTab(desk: Desk, key: string): Desk {
  if (!desk.tabs.some((tab) => tab.key === key && tab.preview === true)) {
    return desk;
  }
  return {
    ...desk,
    tabs: desk.tabs.map((tab) =>
      tab.key === key ? { ...tab, preview: false } : tab,
    ),
  };
}

export interface OpenOptions {
  /** false면 붙이기만 하고 보던 tab을 그대로 둔다. */
  readonly select?: boolean;
  /** 이 tab 바로 뒤에 넣는다. tabs에 없으면 끝이다. group의 구성원이면 group 뒤로 비킨다. */
  readonly after?: string;
  /** 저장 안 된 변경이 있는 tab. preview 자리를 바꿔 쓸 때 이 tab은 사라지지 않고 고정 tab으로 남는다. */
  readonly unsaved?: (key: string) => boolean;
}

/**
 * host.openTab의 규칙. 이미 tabs에 있으면 새로 붙이지 않고 고르며(고정으로 여는 길이면 preview를 푼다), 접힌
 * float이면 펴고, detached면 그대로다. 새 preview tab은 desk의 preview 자리를 바꿔 쓴다.
 */
export function openTab(
  desk: Desk,
  tab: TabItem,
  options: OpenOptions = {},
): Desk {
  const select = options.select !== false;
  switch (whereInDesk(desk, tab.key)) {
    case "tab": {
      const pinned = tab.preview === true ? desk : pinTab(desk, tab.key);
      return select ? selectTab(pinned, tab.key) : pinned;
    }
    case "float":
      return select ? restoreFloat(desk, tab.key) : desk;
    case "detached":
      return desk;
  }
  let base = desk;
  const old =
    tab.preview === true ? desk.tabs.find((item) => item.preview) : undefined;
  if (old !== undefined) {
    if (options.unsaved?.(old.key) !== true) {
      return replaceTab(desk, old.key, tab, select);
    }
    base = pinTab(desk, old.key);
  }
  const afterAt =
    options.after === undefined
      ? -1
      : base.tabs.findIndex((item) => item.key === options.after);
  const group =
    options.after === undefined ? null : groupOf(base, options.after);
  const at =
    afterAt < 0
      ? base.tabs.length
      : group === null
        ? afterAt + 1
        : Math.max(
            ...leavesOf(group.layout).map((key) =>
              base.tabs.findIndex((item) => item.key === key),
            ),
          ) + 1;
  return {
    ...base,
    tabs: [...base.tabs.slice(0, at), tab, ...base.tabs.slice(at)],
    selected: select ? tab.key : (base.selected ?? tab.key),
  };
}

// tabs의 old 자리에 tab을 넣는다. group 구성원이면 group도 새 key를 가리킨다.
function replaceTab(
  desk: Desk,
  old: string,
  tab: TabItem,
  select: boolean,
): Desk {
  const rename = (key: string) => (key === old ? tab.key : key);
  return settle({
    ...desk,
    tabs: desk.tabs.map((item) => (item.key === old ? tab : item)),
    selected: select || desk.selected === old ? tab.key : desk.selected,
    groups: desk.groups.map((group) => renameInGroup(group, rename)),
  });
}

/** selected 칸에서 delta칸 떨어진 칸의 tab을 고른다(group이면 그 focus). 끝에서 반대쪽으로 돈다. */
export function stepTab(desk: Desk, delta: number): Desk {
  const entries = deskEntries(desk);
  if (entries.length === 0) return desk;
  const at = Math.max(
    0,
    entries.findIndex((entry) =>
      entry.tabs.some((tab) => tab.key === desk.selected),
    ),
  );
  const target = entries[(at + delta + entries.length) % entries.length]!;
  return selectTab(desk, target.group?.focus ?? target.key);
}

export function closeTab(desk: Desk, key: string): Desk {
  return dropTab(desk, key);
}

export type CloseScope = "others" | "right" | "saved" | "all";

/**
 * tab 메뉴의 Close others·Close to the right·Close saved·Close all이 닫으려는 tabs의 key. group의 tab은 한 칸이라
 * key가 어느 쪽이든 짝도 기준 칸에 든다(others는 모두 남기고 right는 칸 오른쪽만 닫는다). floats와 detached는 건드리지 않는다.
 * 닫기 확인(beforeClose)은 거르지 않는다. 호출자가 탭마다 거친다.
 */
export function closeTargets(
  desk: Desk,
  scope: CloseScope,
  key: string,
  isUnsaved: (key: string) => boolean,
): string[] {
  const keys = desk.tabs.map((tab) => tab.key);
  const group = groupOf(desk, key);
  const own = group === null ? [key] : leavesOf(group.layout);
  switch (scope) {
    case "others":
      return keys.filter((item) => !own.includes(item));
    case "right": {
      const last = Math.max(...own.map((item) => keys.indexOf(item)));
      return keys.slice(last + 1);
    }
    case "saved":
      return keys.filter((item) => !isUnsaved(item));
    case "all":
      return keys;
  }
}

/** tabs의 tab을 고른다. group 구성원이면 그 group의 focus도 이 tab이 된다. */
export function selectTab(desk: Desk, key: string): Desk {
  if (!desk.tabs.some((tab) => tab.key === key)) return desk;
  const group = groupOf(desk, key);
  if (desk.selected === key && (group === null || group.focus === key)) {
    return desk;
  }
  return {
    ...desk,
    selected: key,
    groups:
      group === null
        ? desk.groups
        : desk.groups.map((item) =>
            item === group ? { ...item, focus: key } : item,
          ),
  };
}

/** 고른 group의 index번째(0부터) leaf를 고른다. group이 아니거나 그 leaf가 없으면 그대로다. */
export function focusLeaf(desk: Desk, index: number): Desk {
  const group = groupOf(desk, desk.selected);
  const key = group === null ? undefined : leavesOf(group.layout)[index];
  return key === undefined ? desk : selectTab(desk, key);
}

// toIndex가 다른 group 한가운데면 그 group 바깥으로 비킨다. 움직인 방향의 바깥이다.
function outsideGroups(
  desk: Desk,
  rest: readonly TabItem[],
  at: number,
  from: number,
  own: Group | null,
): number {
  for (const group of desk.groups) {
    if (group === own) continue;
    const keys = leavesOf(group.layout);
    const start = rest.findIndex((tab) => tab.key === keys[0]);
    const before = desk.tabs.findIndex((tab) => tab.key === keys[0]);
    if (start >= 0 && at > start && at < start + keys.length) {
      return from < before ? start + keys.length : start;
    }
  }
  return at;
}

/**
 * key를 tabs 안의 toIndex로 옮긴다(옮긴 뒤의 index). group 구성원이면 group의 tab이 모두 leaf 순서로 붙어서 함께
 * 가고, 다른 group의 tab 사이로는 들어가지 못한다.
 */
export function moveTab(desk: Desk, key: string, toIndex: number): Desk {
  const from = desk.tabs.findIndex((tab) => tab.key === key);
  if (from < 0) return desk;
  const group = groupOf(desk, key);
  const keys = group === null ? [key] : leavesOf(group.layout);
  const moving = keys.map((item) => desk.tabs.find((tab) => tab.key === item)!);
  const rest = desk.tabs.filter((tab) => !keys.includes(tab.key));
  let at = toIndex - keys.indexOf(key);
  at = outsideGroups(
    desk,
    rest,
    Math.max(0, Math.min(at, rest.length)),
    from,
    group,
  );
  const tabs = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return tabs.every((tab, index) => tab === desk.tabs[index])
    ? desk
    : { ...desk, tabs };
}

/**
 * 칸(entry)을 끌어 놓은 자리. key가 든 group이면 그 tab이 모두 함께, before 칸(그 칸의 첫 tab의 key) 앞에 가고 null이면
 * 끝이다. 줄의 끌어 순서 바꾸기가 쓴다.
 */
export function reorderTab(
  desk: Desk,
  key: string,
  before: string | null,
): Desk {
  const own = groupOf(desk, key);
  const moving = new Set(own === null ? [key] : leavesOf(own.layout));
  const rest = desk.tabs.filter((tab) => !moving.has(tab.key));
  const at =
    before === null ? rest.length : rest.findIndex((tab) => tab.key === before);
  return at < 0 ? desk : moveTab(desk, key, at);
}

export type DropSide = "left" | "right" | "top" | "bottom";

export interface SplitOptions {
  /** 합친 뒤 고를 tab. 기본은 옮겨 온 newKey다. */
  readonly select?: "target" | "new";
}

/**
 * newKey를 targetKey 옆(side)에 놓는다. target이 group 구성원이면 그 group의 leaf로 끼고, 아니면 둘로 새 group을
 * 만든다. newKey는 있던 자리(tabs 위치, 다른 group)에서 빠진다. 둘 다 tabs에 있어야 하고, group이 이미 4개
 * leaf면(같은 group 안에서 옮기는 경우는 빼고) 그대로다.
 */
export function splitTab(
  desk: Desk,
  targetKey: string,
  newKey: string,
  side: DropSide,
  options: SplitOptions = {},
): Desk {
  if (targetKey === newKey) return desk;
  const inTabs = (key: string) => desk.tabs.some((tab) => tab.key === key);
  if (!inTabs(targetKey) || !inTabs(newKey)) return desk;
  const target = groupOf(desk, targetKey);
  const from = groupOf(desk, newKey);
  const base =
    target === null
      ? null
      : target === from
        ? (removeLeaf(target.layout, newKey) ?? null)
        : target.layout;
  if (base !== null && leavesOf(base).length >= GROUP_MAX) return desk;
  const added: GroupNode = { tab: newKey };
  const here = base === null ? ({ tab: targetKey } as GroupNode) : base;
  const dir: SplitDir = side === "left" || side === "right" ? "row" : "column";
  const first = side === "left" || side === "top";
  const layout = replaceLeaf(here, targetKey, (leaf) => ({
    dir,
    ratio: 0.5,
    a: first ? added : leaf,
    b: first ? leaf : added,
  }));
  const selected = options.select === "target" ? targetKey : newKey;
  // newKey는 target 바로 뒤로 옮겨 group이 target 자리에 선다.
  const tabNew = desk.tabs.find((tab) => tab.key === newKey)!;
  const without = desk.tabs.filter((tab) => tab.key !== newKey);
  const at = without.findIndex((tab) => tab.key === targetKey) + 1;
  const tabs = [...without.slice(0, at), tabNew, ...without.slice(at)];
  const groups = desk.groups.map((group) => {
    if (group === target) return { layout, focus: selected };
    if (group === from) {
      const rest = removeLeaf(group.layout, newKey);
      return rest === null ? group : { layout: rest, focus: group.focus };
    }
    return group;
  });
  return settle({
    ...desk,
    tabs,
    selected,
    groups: target === null ? [...groups, { layout, focus: selected }] : groups,
  });
}

/**
 * "Split right/down"과 pane.split이 key 옆에 붙일 tab: key의 칸 뒤의 첫 plain tab, 없으면 앞의 마지막 plain tab.
 * group에 든 tab은 후보가 아니다. 후보가 없거나 key의 group이 이미 가득 차면 null이다.
 */
export function splitPartner(desk: Desk, key: string): string | null {
  const own = groupOf(desk, key);
  if (own !== null && leavesOf(own.layout).length >= GROUP_MAX) return null;
  const keys = desk.tabs.map((tab) => tab.key);
  const span = own === null ? [key] : leavesOf(own.layout);
  const first = keys.indexOf(span[0]!);
  const plain = (item: string) => groupOf(desk, item) === null && item !== key;
  const after = keys.slice(first + span.length).find(plain);
  return after ?? keys.slice(0, first).findLast(plain) ?? null;
}

/** 두 tab의 자리를 맞바꾼다: leaf끼리(같은 group이거나 다른 group)이거나 leaf와 group에 없는 tab. */
export function swapTabs(desk: Desk, a: string, b: string): Desk {
  const at = desk.tabs.findIndex((tab) => tab.key === a);
  const bt = desk.tabs.findIndex((tab) => tab.key === b);
  if (a === b || at < 0 || bt < 0) return desk;
  const swap = (key: string) => (key === a ? b : key === b ? a : key);
  const tabs = desk.tabs.map((tab, index) =>
    index === at ? desk.tabs[bt]! : index === bt ? desk.tabs[at]! : tab,
  );
  return settle({
    ...desk,
    tabs,
    groups: desk.groups.map((group) => renameInGroup(group, swap)),
  });
}

/**
 * group의 leaf 하나를 group에 없는 tab으로 꺼내 고른다. toIndex(옮긴 뒤의 index)를 주면 거기, 없으면 남은 group 바로
 * 뒤다. 1개로 줄면 group은 풀린다.
 */
export function ungroupTab(desk: Desk, key: string, toIndex?: number): Desk {
  const group = groupOf(desk, key);
  if (group === null) return desk;
  const left = removeLeaf(group.layout, key);
  if (left === null) return desk;
  const from = desk.tabs.findIndex((tab) => tab.key === key);
  const moving = desk.tabs[from]!;
  const rest = desk.tabs.filter((tab) => tab.key !== key);
  const shrunk: Desk = {
    ...desk,
    groups: desk.groups.map((item) =>
      item === group ? { layout: left, focus: item.focus } : item,
    ),
  };
  const end =
    Math.max(
      ...leavesOf(left).map((item) =>
        rest.findIndex((tab) => tab.key === item),
      ),
    ) + 1;
  const at =
    toIndex === undefined
      ? end
      : outsideGroups(
          shrunk,
          rest,
          Math.max(0, Math.min(toIndex, rest.length)),
          from,
          null,
        );
  return settle({
    ...shrunk,
    tabs: [...rest.slice(0, at), moving, ...rest.slice(at)],
    selected: key,
  });
}

/** key가 든 group을 푼다. tab은 그 자리에 plain tab으로 남는다. */
export function ungroup(desk: Desk, key: string): Desk {
  const group = groupOf(desk, key);
  return group === null
    ? desk
    : { ...desk, groups: desk.groups.filter((item) => item !== group) };
}

/** key가 든 group에서 path의 나눔 node의 몫(a의 몫)을 정한다. 범위 밖이면 가장자리로 당긴다. */
export function setRatio(
  desk: Desk,
  key: string,
  path: NodePath,
  ratio: number,
): Desk {
  const group = groupOf(desk, key);
  if (group === null) return desk;
  const layout = setNodeRatio(group.layout, path, ratio);
  return layout === group.layout
    ? desk
    : {
        ...desk,
        groups: desk.groups.map((item) =>
          item === group ? { ...item, layout } : item,
        ),
      };
}

/** tabs의 tab을 떠 있는 패널로 만든다(맨 위). 상한이면 그대로다. */
export function floatTab(desk: Desk, key: string, rect: FloatRect): Desk {
  const found = desk.tabs.find((tab) => tab.key === key);
  if (found === undefined || desk.floats.length >= FLOATS_MAX) return desk;
  const dropped = dropTab(desk, key);
  return {
    ...dropped,
    floats: [
      ...dropped.floats,
      { tab: { ...found, preview: false }, rect, minimized: false },
    ],
  };
}

/** 새 tab을 곧바로 떠 있는 패널로 연다(popup). 어디에든 이미 있거나 상한이면 그대로다. */
export function openFloatTab(desk: Desk, tab: TabItem, rect: FloatRect): Desk {
  if (whereInDesk(desk, tab.key) !== null || desk.floats.length >= FLOATS_MAX) {
    return desk;
  }
  return {
    ...desk,
    floats: [...desk.floats, { tab, rect, minimized: false }],
  };
}

const FLOAT_SHARE = 0.6;

/** 떠 있는 패널의 처음 자리. size를 주면 그 크기, 없으면 area의 60%이고 area 가운데에 둔다. */
export function newFloatRect(area: FloatArea, size?: FloatArea): FloatRect {
  const { width, height } = clampFloatRect(
    {
      x: 0,
      y: 0,
      width: size?.width ?? area.width * FLOAT_SHARE,
      height: size?.height ?? area.height * FLOAT_SHARE,
    },
    area,
  );
  return clampFloatRect(
    {
      x: Math.round((area.width - width) / 2),
      y: Math.round((area.height - height) / 2),
      width,
      height,
    },
    area,
  );
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
  return {
    ...removed,
    detached: [
      ...removed.detached,
      { tab: { ...tab, preview: false }, bounds },
    ],
  };
}

/** detached 창 안에서 열린 popup을 곧바로 detached로 둔다. 어디에든 이미 있거나 상한이면 그대로다. */
export function openDetachedTab(
  desk: Desk,
  tab: TabItem,
  bounds: DetachedBounds,
): Desk {
  if (
    whereInDesk(desk, tab.key) !== null ||
    desk.detached.length >= DETACHED_MAX
  ) {
    return desk;
  }
  return { ...desk, detached: [...desk.detached, { tab, bounds }] };
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

/** 고른 칸의 key. group의 구성원을 골랐으면 group의 key(첫 leaf)다(tab 줄의 한 칸이 group 하나이므로). */
export function entryKey(desk: Desk): string | null {
  const group = groupOf(desk, desk.selected);
  return group === null ? desk.selected : groupKey(group);
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
  options?: OpenOptions,
): PlaceLayout {
  const at = findTab(layout, tab.key)?.desk ?? layout.active;
  return updateDesk(setActiveDesk(layout, at), at, (desk) =>
    openTab(desk, tab, options),
  );
}

/** desk 하나의 모든 tab(tabs, floats, detached 차례). */
export function deskTabs(desk: Desk): TabItem[] {
  return [
    ...desk.tabs,
    ...desk.floats.map((item) => item.tab),
    ...desk.detached.map((item) => item.tab),
  ];
}

/** layout 전체의 모든 tab. */
export function allTabs(layout: PlaceLayout): TabItem[] {
  return Object.values(layout.desks).flatMap(deskTabs);
}

/** 모든 desk의 모든 tab에 change를 적용한다. 바뀐 것이 없으면 layout 그대로다. */
export function mapLayoutTabs(
  layout: PlaceLayout,
  change: (tab: TabItem) => TabItem,
): PlaceLayout {
  let changed = false;
  const apply = (tab: TabItem) => {
    const next = change(tab);
    if (next !== tab) changed = true;
    return next;
  };
  const desks = Object.fromEntries(
    Object.entries(layout.desks).map(([key, desk]) => [
      key,
      {
        ...desk,
        tabs: desk.tabs.map(apply),
        floats: desk.floats.map((item) => ({ ...item, tab: apply(item.tab) })),
        detached: desk.detached.map((item) => ({
          ...item,
          tab: apply(item.tab),
        })),
      },
    ]),
  );
  return changed ? { ...layout, desks } : layout;
}
