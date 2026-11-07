// shell의 desk model. workspace(Home, project, app)마다 desk 여럿이 있고, desk 하나가 tab 줄·group·float·detached를
// 통째로 가진다. 모든 함수는 순수하고 새 값을 돌려준다. 바꿀 수 없으면 같은 참조를 돌려준다.
//
// 불변 조건: desk 안에서 tab key는 tabs·floats·detached를 통틀어 한 번만 나온다. `selected`는 tabs의 key다.
// group은 tabs의 tab 2~4개를 한 칸으로 묶은 값이다. leaf key는 모두 tabs에 있고 tab은 group 하나에만 들며,
// group의 tab은 tabs에서 leaf 순서(왼쪽·위에서부터)로 붙어 있다. 1개로 줄면 group은 풀린다. `selected`가 group
// 구성원이면 그 group의 `focus`가 selected다. 모든 변경은 끝에 `settle`을 거쳐 이를 맞춘다.
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  clampFloatRect,
  type DetachedBounds,
  type DetachedItem,
  type FloatArea,
  type FloatRect,
  type TabItem,
} from "../workspace/model.ts";

export type { DetachedBounds, DetachedItem, FloatArea, FloatRect, TabItem };

export type WorkspaceRef = { kind: "home" } | Workspace;

/** layout 파일 이름이자 workspace 구분 key. `home` | project id | app id. */
export function workspaceKey(ref: WorkspaceRef): string {
  return ref.kind === "home" ? "home" : ref.id;
}

/** 기본 desk의 key. 옛 layout과 같은 값이고 workflow 이름(slug)과 겹치지 않는다. */
export const MAIN_DESK = "_default";
export const MAIN_LABEL = "Main";

// main/workspace/workspace-layout.ts의 상한과 같다. 넘기면 저장이 통째로 거절된다.
const FLOATS_MAX = 20;
const DETACHED_MAX = 20;
const DESKS_MAX = 200;

export interface FloatTab {
  readonly tab: TabItem;
  /** minimized여도 접기 전 rect를 지닌다. */
  readonly rect: FloatRect;
  readonly minimized: boolean;
  /** 고정(always on top). 고정한 패널은 늘 고정 안 한 패널 위에 있고, 다른 곳을 눌러도 접히지 않는다. */
  readonly pinned: boolean;
}

export type SplitDir = "row" | "column";

/** row는 좌우, column은 위아래. ratio는 a가 차지하는 몫이다. */
export const SPLIT_RATIO_MIN = 0.15;
export const SPLIT_RATIO_MAX = 0.85;

/** group 하나의 leaf 수 범위. */
export const GROUP_MIN = 2;
export const GROUP_MAX = 4;

/**
 * group의 칸 하나. tab이 보이는 tab이다. stack은 칸이 돌려 보는 tab들이고(온 순서, tab 포함) 둘 이상일 때만 있다.
 * stack의 나머지 tab은 tabs에 있지만 tab 줄과 card에 보이지 않는다.
 */
export interface GroupLeaf {
  readonly tab: string;
  readonly stack?: readonly string[];
}

/** group의 배치 tree. leaf는 칸이고 나눔은 row(a가 왼쪽)나 column(a가 위)이다. */
export type GroupNode =
  | GroupLeaf
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

/** 빠른 실행. order는 단추 id의 순서, apps는 고정한 앱 panel 화면, hidden은 끈 단추 id다. project layout에 없으면 전역 값이다. */
export interface WorkspaceQuick {
  readonly order: readonly string[];
  readonly apps: readonly { readonly app: string; readonly surface: string }[];
  readonly hidden?: readonly string[];
}

/** project만의 터미널 명령. Terminal hover 목록에서 새 터미널로 돈다. 전역 값과 합치지 않고 빠른 실행 `quick`과 별개로 남는다. */
export interface QuickCommand {
  readonly id: string;
  readonly label: string;
  readonly command: string;
}

export interface WorkspaceLayout {
  readonly active: string;
  readonly desks: Readonly<Record<string, Desk>>;
  readonly quick?: WorkspaceQuick;
  readonly commands?: readonly QuickCommand[];
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

export function defaultWorkspaceLayout(): WorkspaceLayout {
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

const isLeaf = (node: GroupNode): node is GroupLeaf => "tab" in node;

function leafNodes(node: GroupNode): GroupLeaf[] {
  return isLeaf(node) ? [node] : [...leafNodes(node.a), ...leafNodes(node.b)];
}

/** 칸이 돌려 보는 tab들(온 순서). stack이 없으면 보이는 tab 하나다. */
export function stackOf(leaf: GroupLeaf): readonly string[] {
  return leaf.stack ?? [leaf.tab];
}

function paneLeaf(tab: string, stack: readonly string[]): GroupLeaf {
  return stack.length < 2 ? { tab } : { tab, stack };
}

/** group tree의 보이는 leaf key를 왼쪽·위에서부터 차례로. */
export function leavesOf(node: GroupNode): string[] {
  return leafNodes(node).map((leaf) => leaf.tab);
}

/** group의 모든 tab: 보이는 leaf(leaf 순서) 다음 칸에 숨은 tab. tabs에서 이 순서로 붙어 있다. */
export function membersOf(node: GroupNode): string[] {
  const leaves = leafNodes(node);
  return [
    ...leaves.map((leaf) => leaf.tab),
    ...leaves.flatMap((leaf) =>
      stackOf(leaf).filter((key) => key !== leaf.tab),
    ),
  ];
}

/** layout에서 key가 든 칸(보이든 숨었든)의 stack. 칸에 없으면 [key]다. */
export function stackOfLeaf(node: GroupNode, key: string): readonly string[] {
  const leaf = leafNodes(node).find((item) => stackOf(item).includes(key));
  return leaf === undefined ? [key] : stackOf(leaf);
}

/** key가 든 칸(보이든 숨었든)의 stack. group에 없으면 [key]다. */
export function paneStackOf(desk: Desk, key: string): readonly string[] {
  const group = groupOf(desk, key);
  return group === null ? [key] : stackOfLeaf(group.layout, key);
}

// stack에서 key 대신 보일 tab: 뒤의 것, 없으면 앞의 것. tab 줄에서 닫은 tab의 이웃을 고르는 것과 같다.
function heirOf(
  stack: readonly string[],
  key: string,
  keep: (key: string) => boolean,
): string | undefined {
  const at = stack.indexOf(key);
  return stack.slice(at + 1).find(keep) ?? stack.slice(0, at).findLast(keep);
}

/**
 * keep이 거른 tab을 칸에서 뺀다. 보이는 tab이 빠지면 stack의 이웃이 이어받고, 칸이 비면 leaf가 지워져 짝이 부모
 * 자리로 올라온다. 모두 지워지면 null. 바뀐 것이 없으면 같은 참조다.
 */
export function pruneNode(
  node: GroupNode,
  keep: (key: string) => boolean,
): GroupNode | null {
  if (isLeaf(node)) {
    const all = stackOf(node);
    const stack = all.filter(keep);
    if (stack.length === all.length) return node;
    if (stack.length === 0) return null;
    return paneLeaf(
      keep(node.tab) ? node.tab : heirOf(all, node.tab, keep)!,
      stack,
    );
  }
  const a = pruneNode(node.a, keep);
  const b = pruneNode(node.b, keep);
  if (a === null) return b;
  if (b === null) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

// key가 숨은 칸이 key를 보이게 한다.
function surface(node: GroupNode, key: string): GroupNode {
  if (isLeaf(node)) {
    return node.tab !== key && stackOf(node).includes(key)
      ? { tab: key, stack: stackOf(node) }
      : node;
  }
  const a = surface(node.a, key);
  const b = surface(node.b, key);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** 두 leaf 사이마다 놓이는 나눔 방향(leaf 순서). 줄의 반쪽 사이 표시가 쓴다. */
export function dirsOf(node: GroupNode): SplitDir[] {
  return isLeaf(node) ? [] : [...dirsOf(node.a), node.dir, ...dirsOf(node.b)];
}

/** group의 key. 첫 leaf이고 tab 줄에서 한 칸의 key다. */
export function groupKey(group: Group): string {
  return leavesOf(group.layout)[0]!;
}

/** key의 tab이 든 group(칸에 숨은 tab도). 없으면 null. */
export function groupOf(desk: Desk, key: string | null): Group | null {
  if (key === null) return null;
  return (
    desk.groups.find((group) => membersOf(group.layout).includes(key)) ?? null
  );
}

// key를 group에서 뺀다. 칸의 stack에 다른 tab이 있으면 칸은 남고 이웃이 보인다. 칸이 비면 짝이 부모 자리로 올라온다.
function removeLeaf(node: GroupNode, key: string): GroupNode | null {
  return pruneNode(node, (item) => item !== key);
}

function replaceLeaf(
  node: GroupNode,
  key: string,
  by: (leaf: GroupLeaf) => GroupNode,
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
    const tab = rename(node.tab);
    const stack = node.stack?.map(rename);
    return tab === node.tab &&
      stack?.every((key, i) => key === node.stack![i]) !== false
      ? node
      : paneLeaf(tab, stack ?? [tab]);
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

// 모든 변경의 끝에서 group 불변 조건을 맞춘다: tabs에 없거나 다른 group에 이미 든 tab을 빼고(보이는 tab이 빠진
// 칸은 stack의 이웃이 이어받는다), 칸이 1개로 줄면 풀고, selected가 칸에 숨어 있으면 그 칸이 selected를 보이고,
// focus가 leaf가 아니면 첫 leaf로, selected가 구성원이면 selected로 맞추고, group의 tab을 첫 구성원 자리에
// membersOf 순서로 붙인다. 바뀐 것이 없으면 같은 참조다. 저장된 값을 읽고 쓸 때(layout-source.ts)도 쓴다.
export function settle(desk: Desk): Desk {
  const inTabs = new Set(desk.tabs.map((tab) => tab.key));
  const used = new Set<string>();
  const groups: Group[] = [];
  for (const group of desk.groups) {
    const pruned = pruneNode(
      group.layout,
      (key) => inTabs.has(key) && !used.has(key),
    );
    if (pruned === null) continue;
    const layout =
      desk.selected === null ? pruned : surface(pruned, desk.selected);
    const leaves = leavesOf(layout);
    if (leaves.length < GROUP_MIN) continue;
    for (const key of membersOf(layout)) used.add(key);
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
    for (const key of membersOf(group.layout)) owner.set(key, group);
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
      for (const key of membersOf(group.layout)) tabs.push(byKey.get(key)!);
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

/** tab 줄의 한 칸. group이면 보이는 leaf의 tab이 leaf 순서로 든다(칸에 숨은 tab은 없다). */
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

// tabs에서 key를 뺀다. group 구성원이면 group에서도 빠지고(1개로 줄면 풀린다), 고른 tab이면 칸의 stack에서
// 이어받는 tab, 없으면 group의 이웃 leaf(없으면 tabs의 이웃)로 옮긴다.
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
      heirOf(paneStackOf(desk, key), key, (item) => item !== key) ??
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
  /**
   * `after` tab(터미널)의 옆 칸에 연다. 새 tab일 때만이고, `after`가 tabs에 없거나 `select: false`면 `after` 뒤에
   * 넣기만 한다. 자세한 칸 규칙은 `openBeside`다.
   */
  readonly beside?: boolean;
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
  const beside =
    options.beside === true &&
    select &&
    options.after !== undefined &&
    desk.tabs.some((item) => item.key === options.after);
  const old =
    tab.preview === true ? desk.tabs.find((item) => item.preview) : undefined;
  if (old !== undefined) {
    if (options.unsaved?.(old.key) !== true) {
      // 옆 칸에 열 때는 자리를 바꿔 쓰지 않고 지운다. 옛 preview가 멀리 있으면 새 tab이 안 보이기 때문이다.
      if (!beside) return replaceTab(desk, old.key, tab, select);
      base = dropTab(desk, old.key);
    } else base = pinTab(desk, old.key);
  }
  if (beside) return openBeside(base, tab, options.after!);
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
            ...membersOf(group.layout).map((key) =>
              base.tabs.findIndex((item) => item.key === key),
            ),
          ) + 1;
  return {
    ...base,
    tabs: [...base.tabs.slice(0, at), tab, ...base.tabs.slice(at)],
    selected: select ? tab.key : (base.selected ?? tab.key),
  };
}

// 새 tab을 source(터미널) 옆 칸에 열고 고른다. source가 group에 없으면 [source | tab]을 row 0.5로 새로 묶고,
// group에 있으면 source 다음 leaf(돌아서)의 칸 stack 끝에 쌓여 보인다. 전에 보이던 tab은 그 칸에 숨어 남고
// 칸 머리에서 돌려 본다. group은 자라지 않는다.
function openBeside(desk: Desk, tab: TabItem, source: string): Desk {
  const at = desk.tabs.findIndex((item) => item.key === source) + 1;
  const added: Desk = {
    ...desk,
    tabs: [...desk.tabs.slice(0, at), settled(tab), ...desk.tabs.slice(at)],
  };
  const group = groupOf(desk, source);
  if (group === null) return splitTab(added, source, tab.key, "right");
  const leaves = leavesOf(group.layout);
  const next = leaves[(leaves.indexOf(source) + 1) % leaves.length]!;
  return settle({
    ...added,
    selected: tab.key,
    groups: added.groups.map((item) =>
      item === group
        ? {
            layout: replaceLeaf(group.layout, next, (leaf) =>
              paneLeaf(tab.key, [...stackOf(leaf), tab.key]),
            ),
            focus: tab.key,
          }
        : item,
    ),
  });
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

export type CloseScope =
  | "others"
  | "pane-others"
  | "group"
  | "right"
  | "saved"
  | "all";

/**
 * tab 메뉴의 Close others·Close others in pane·Close group·Close to the right·Close saved·Close all이 닫으려는 tabs의
 * key. group의 tab은 한 칸이라 key가 어느 쪽이든 짝과 칸에 숨은 tab도 기준 칸에 든다(others는 모두 남기고 right는 칸
 * 오른쪽만 닫는다). pane-others는 key가 든 칸의 다른 tab만, group은 key가 든 group 전부다. floats와 detached는 건드리지
 * 않는다. 닫기 확인(beforeClose)은 거르지 않는다. 호출자가 거친다.
 */
export function closeTargets(
  desk: Desk,
  scope: CloseScope,
  key: string,
  isUnsaved: (key: string) => boolean,
): string[] {
  const keys = desk.tabs.map((tab) => tab.key);
  const group = groupOf(desk, key);
  const own = group === null ? [key] : membersOf(group.layout);
  switch (scope) {
    case "others":
      return keys.filter((item) => !own.includes(item));
    case "pane-others": {
      const stack = paneStackOf(desk, key);
      return keys.filter((item) => item !== key && stack.includes(item));
    }
    case "group":
      return keys.filter((item) => own.includes(item));
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

/** tabs의 tab을 고른다. group 구성원이면 그 group의 focus도 이 tab이 되고, 칸에 숨어 있었으면 그 칸이 보인다. */
export function selectTab(desk: Desk, key: string): Desk {
  if (!desk.tabs.some((tab) => tab.key === key)) return desk;
  const group = groupOf(desk, key);
  const layout = group === null ? null : surface(group.layout, key);
  if (
    desk.selected === key &&
    (group === null || (group.focus === key && layout === group.layout))
  ) {
    return desk;
  }
  const next: Desk = {
    ...desk,
    selected: key,
    groups:
      group === null
        ? desk.groups
        : desk.groups.map((item) =>
            item === group ? { layout: layout!, focus: key } : item,
          ),
  };
  // 칸이 보이는 tab을 바꾸면 tabs의 group 순서(membersOf)도 바뀐다.
  return group !== null && layout !== group.layout ? settle(next) : next;
}

/** key가 보이는 칸에서 delta만큼 떨어진 tab을 보이고 고른다. 끝에서 반대쪽으로 돈다. stack이 없으면 그대로다. */
export function cyclePane(desk: Desk, key: string, delta: number): Desk {
  const stack = paneStackOf(desk, key);
  if (stack.length < 2) return desk;
  const at = stack.indexOf(key);
  const next = (((at + delta) % stack.length) + stack.length) % stack.length;
  return selectTab(desk, stack[next]!);
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
    const keys = membersOf(group.layout);
    const start = rest.findIndex((tab) => tab.key === keys[0]);
    const before = desk.tabs.findIndex((tab) => tab.key === keys[0]);
    if (start >= 0 && at > start && at < start + keys.length) {
      return from < before ? start + keys.length : start;
    }
  }
  return at;
}

/**
 * key를 tabs 안의 toIndex로 옮긴다(옮긴 뒤의 index). group 구성원이면 group의 tab이 모두(칸에 숨은 tab도)
 * membersOf 순서로 붙어서 함께 가고, 다른 group의 tab 사이로는 들어가지 못한다.
 */
export function moveTab(desk: Desk, key: string, toIndex: number): Desk {
  const from = desk.tabs.findIndex((tab) => tab.key === key);
  if (from < 0) return desk;
  const group = groupOf(desk, key);
  const keys = group === null ? [key] : membersOf(group.layout);
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
  const moving = new Set(own === null ? [key] : membersOf(own.layout));
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
  const span = own === null ? [key] : membersOf(own.layout);
  const first = keys.indexOf(span[0]!);
  const plain = (item: string) => groupOf(desk, item) === null && item !== key;
  const after = keys.slice(first + span.length).find(plain);
  return after ?? keys.slice(0, first).findLast(plain) ?? null;
}

/**
 * key를 targetKey가 보이는 칸의 stack index 자리(없으면 끝)에 넣어 보이고 고른다. key는 있던 자리(다른 칸, 다른
 * group)에서 빠지고, 이미 그 칸에 있으면 자리만 옮긴다. target이 group의 보이는 leaf가 아니거나 바뀌는 것이 없으면
 * 그대로다.
 */
export function stackTab(
  desk: Desk,
  targetKey: string,
  key: string,
  index?: number,
): Desk {
  const target = groupOf(desk, targetKey);
  if (
    target === null ||
    !leavesOf(target.layout).includes(targetKey) ||
    !desk.tabs.some((tab) => tab.key === key)
  ) {
    return desk;
  }
  const insert = (stack: readonly string[], at: number | undefined) => {
    const rest = stack.filter((item) => item !== key);
    const to = Math.max(0, Math.min(at ?? rest.length, rest.length));
    return [...rest.slice(0, to), key, ...rest.slice(to)];
  };
  const current = stackOfLeaf(target.layout, targetKey);
  if (current.includes(key)) {
    // 같은 칸 안에서 옮기면 빠진 자리만큼 index가 당겨진다.
    const at =
      index !== undefined && current.indexOf(key) < index ? index - 1 : index;
    const stack = insert(current, at);
    if (key === targetKey && stack.every((item, i) => item === current[i])) {
      return desk;
    }
    const layout = replaceLeaf(target.layout, targetKey, () =>
      paneLeaf(key, stack),
    );
    return settle({
      ...desk,
      selected: key,
      groups: desk.groups.map((group) =>
        group === target ? { layout, focus: key } : group,
      ),
    });
  }
  const from = groupOf(desk, key);
  const base =
    from === target ? removeLeaf(target.layout, key)! : target.layout;
  const layout = replaceLeaf(base, targetKey, (leaf) =>
    paneLeaf(key, insert(stackOf(leaf), index)),
  );
  // key를 target 바로 뒤로 옮겨 group이 제자리에 남는다.
  const moving = desk.tabs.find((tab) => tab.key === key)!;
  const without = desk.tabs.filter((tab) => tab.key !== key);
  const at = without.findIndex((tab) => tab.key === targetKey) + 1;
  return settle({
    ...desk,
    tabs: [...without.slice(0, at), moving, ...without.slice(at)],
    selected: key,
    groups: desk.groups.map((group) => {
      if (group === target) return { layout, focus: key };
      if (group === from) {
        const rest = removeLeaf(group.layout, key);
        return rest === null ? group : { layout: rest, focus: group.focus };
      }
      return group;
    }),
  });
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
 * 뒤다. 칸의 stack에 다른 tab이 있으면 칸은 남고 이웃이 보인다(칸에서 꺼내기). 1개로 줄면 group은 풀린다.
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
      ...membersOf(left).map((item) =>
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

/** 끌고 있는 tab. whole은 tab 줄의 group 칸을 통째로 끈다(group이 아닌 칸이나 칸의 leaf 하나를 끄는 것과 다르다). */
export interface TabDragItem {
  readonly key: string;
  readonly whole: boolean;
}

export type PaneZone = DropSide | "center";

/** 놓을 자리: tab 줄(before 칸 앞, null이면 끝)이나 칸(target tab)의 한 구역. */
/**
 * 놓을 자리: tab 줄(before 칸 앞, null이면 끝), 칸(target tab)의 한 구역, 또는 tab 줄 group 칸 안의 한 칸 stack 자리(target은
 * 그 칸에 보이는 tab, index는 넣을 자리).
 */
export type TabDropHit =
  | { readonly kind: "strip"; readonly before: string | null }
  | { readonly kind: "pane"; readonly target: string; readonly zone: PaneZone }
  | { readonly kind: "stack"; readonly target: string; readonly index: number };

/**
 * ok면 놓을 수 있고, full은 group이 가득 차서 못 놓고, none은 의미가 없다(자기 자신, 바뀌는 것이 없음, group 통째로
 * 칸에 놓기, 옮기면 group이 풀리는 쌓기).
 */
export type TabDropState = "ok" | "full" | "none";

export function tabDropState(
  desk: Desk,
  item: TabDragItem,
  hit: TabDropHit,
): TabDropState {
  if (!desk.tabs.some((tab) => tab.key === item.key)) return "none";
  if (hit.kind === "strip") return "ok";
  if (hit.kind === "stack") {
    if (item.whole) return "none";
    const next = stackTab(desk, hit.target, item.key, hit.index);
    return next === desk || groupOf(next, item.key) === null ? "none" : "ok";
  }
  if (item.whole || hit.target === item.key) return "none";
  if (!desk.tabs.some((tab) => tab.key === hit.target)) return "none";
  if (hit.zone === "center") {
    // group 칸의 가운데는 그 칸에 쌓기다. 옮기고 나면 group이 풀리는 경우(둘뿐인 group의 짝)는 놓지 않는다.
    if (groupOf(desk, hit.target) === null) return "ok";
    return groupOf(stackTab(desk, hit.target, item.key), hit.target) === null
      ? "none"
      : "ok";
  }
  const target = groupOf(desk, hit.target);
  if (
    target !== null &&
    target !== groupOf(desk, item.key) &&
    leavesOf(target.layout).length >= GROUP_MAX
  ) {
    return "full";
  }
  return "ok";
}

/**
 * 끌어 놓기를 desk에 적용한다. tab 줄에 놓으면 순서 바꾸기이고 group의 tab 하나(leaf나 칸에 숨은 tab)는 group에서
 * 나온다. tab 줄 group 칸 안의 자리는 그 칸 stack의 그 자리에 넣기(stackTab)다. 칸의 가장자리는 splitTab, group
 * 칸의 가운데는 그 칸에 쌓기(stackTab), group이 아닌 칸의 가운데는 swapTabs다(그 tab이 보인다). 못 놓으면 desk
 * 그대로다.
 */
export function applyTabDrop(
  desk: Desk,
  item: TabDragItem,
  hit: TabDropHit,
): Desk {
  if (tabDropState(desk, item, hit) !== "ok") return desk;
  if (hit.kind === "stack") {
    return stackTab(desk, hit.target, item.key, hit.index);
  }
  if (hit.kind === "strip") {
    if (item.whole || groupOf(desk, item.key) === null) {
      return reorderTab(desk, item.key, hit.before);
    }
    const rest = desk.tabs.filter((tab) => tab.key !== item.key);
    // 자기 group 칸 앞에 놓으면 남은 group의 앞이다(칸의 key가 끌고 있는 leaf일 수 있다).
    const own = leavesOf(groupOf(desk, item.key)!.layout);
    const before = own.includes(hit.before ?? "")
      ? own.find((key) => key !== item.key)!
      : hit.before;
    const at =
      before === null
        ? rest.length
        : rest.findIndex((tab) => tab.key === before);
    return at < 0 ? desk : ungroupTab(desk, item.key, at);
  }
  if (hit.zone !== "center") {
    return splitTab(desk, hit.target, item.key, hit.zone);
  }
  if (groupOf(desk, hit.target) !== null) {
    return stackTab(desk, hit.target, item.key);
  }
  const swapped = swapTabs(desk, item.key, hit.target);
  return groupOf(desk, item.key) === null
    ? selectTab(swapped, item.key)
    : swapped;
}

/** key가 든 group을 푼다. tab은 그 자리에 plain tab으로 남는다(칸에 숨은 tab도 tab 줄에 나온다). */
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
    floats: stacked([
      ...dropped.floats,
      {
        tab: { ...found, preview: false },
        rect,
        minimized: false,
        pinned: false,
      },
    ]),
  };
}

/** 새 tab을 곧바로 떠 있는 패널로 연다(popup). 어디에든 이미 있거나 상한이면 그대로다. */
export function openFloatTab(desk: Desk, tab: TabItem, rect: FloatRect): Desk {
  if (whereInDesk(desk, tab.key) !== null || desk.floats.length >= FLOATS_MAX) {
    return desk;
  }
  return {
    ...desk,
    floats: stacked([
      ...desk.floats,
      { tab, rect, minimized: false, pinned: false },
    ]),
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

// 배열 순서가 위아래 순서라 고정한 패널을 뒤로 모은다. 같은 쪽 안의 순서는 지킨다.
function stacked(floats: readonly FloatTab[]): FloatTab[] {
  return [
    ...floats.filter((item) => !item.pinned),
    ...floats.filter((item) => item.pinned),
  ];
}

/** 접힘을 풀고 맨 위로 올린다. 고정 안 한 패널은 고정한 패널 바로 아래까지다. */
export function restoreFloat(desk: Desk, key: string): Desk {
  const item = desk.floats.find((float) => float.tab.key === key);
  if (item === undefined) return desk;
  const floats = stacked([
    ...desk.floats.filter((float) => float !== item),
    { ...item, minimized: false },
  ]);
  const same =
    !item.minimized && floats.every((float, at) => float === desk.floats[at]);
  return same ? desk : { ...desk, floats };
}

/** 고정을 켜고 끈다. 켜면 고정한 패널 맨 위로 간다. */
export function pinFloat(desk: Desk, key: string, pinned: boolean): Desk {
  const item = desk.floats.find((float) => float.tab.key === key);
  if (item === undefined || item.pinned === pinned) return desk;
  return {
    ...desk,
    floats: stacked([
      ...desk.floats.filter((float) => float !== item),
      { ...item, pinned },
    ]),
  };
}

/** 고정 안 한 펴진 패널을 모두 접는다(`keep`은 남긴다). 패널 밖을 눌렀을 때다. */
export function minimizeLooseFloats(desk: Desk, keep?: string): Desk {
  if (
    !desk.floats.some(
      (item) => !item.pinned && !item.minimized && item.tab.key !== keep,
    )
  ) {
    return desk;
  }
  return {
    ...desk,
    floats: desk.floats.map((item) =>
      item.pinned || item.minimized || item.tab.key === keep
        ? item
        : { ...item, minimized: true },
    ),
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
  layout: WorkspaceLayout,
  key: string,
  change: (desk: Desk) => Desk,
): WorkspaceLayout {
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

export function activeDesk(layout: WorkspaceLayout): Desk {
  return layout.desks[layout.active]!;
}

/** 새 desk를 더한다. key는 부르는 쪽이 정한다(id 주입). 있는 key거나 상한이면 그대로다. */
export function addDesk(
  layout: WorkspaceLayout,
  key: string,
  label: string,
  workflow?: string,
): WorkspaceLayout {
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
  layout: WorkspaceLayout,
  key: string,
  label: string,
): WorkspaceLayout {
  const name = label.trim();
  if (name.length === 0) return layout;
  return updateDesk(layout, key, (desk) =>
    desk.label === name ? desk : { ...desk, label: name },
  );
}

export function setActiveDesk(
  layout: WorkspaceLayout,
  key: string,
): WorkspaceLayout {
  if (!Object.hasOwn(layout.desks, key) || layout.active === key) return layout;
  return { ...layout, active: key };
}

/**
 * desk 자체만 지운다. 사람이 desk를 끝낼 때 호출자가 tab·float·detached를 먼저 닫은 뒤 부른다(남은 것은 사라진다).
 * Main은 지우지 못한다. 보던 desk면 Main으로 간다.
 */
export function removeDesk(
  layout: WorkspaceLayout,
  key: string,
): WorkspaceLayout {
  if (key === MAIN_DESK || layout.desks[key] === undefined) return layout;
  const rest = Object.fromEntries(
    Object.entries(layout.desks).filter(([name]) => name !== key),
  );
  return {
    ...layout,
    active: layout.active === key ? MAIN_DESK : layout.active,
    desks: rest,
  };
}

/**
 * workflow가 끝나 사라진 desk를 Main에 합친다. tabs는 끝에 붙고(group은 그대로 따라온다), float·detached는 상한이
 * 남아 있을 때만 그대로 가며 아니면 tab으로 간다. Main에 이미 같은 key가 있는 tab은 옮기지 않고, 그 key를 가진
 * group의 leaf는 빠지며 1개가 되면 group은 풀린다. 사람이 끝낸 desk에는 쓰지 않는다(removeDesk).
 */
export function mergeDeskIntoMain(
  layout: WorkspaceLayout,
  key: string,
): WorkspaceLayout {
  const gone = layout.desks[key];
  if (key === MAIN_DESK || gone === undefined) return layout;
  let main = layout.desks[MAIN_DESK]!;
  const fresh = (tab: TabItem) => whereInDesk(main, tab.key) === null;
  const freshKeys = new Set(
    gone.tabs.filter((tab) => fresh(tab)).map((tab) => tab.key),
  );
  const carried: Group[] = [];
  for (const group of gone.groups) {
    const node = pruneNode(group.layout, (leaf) => freshKeys.has(leaf));
    if (node === null || leavesOf(node).length < GROUP_MIN) continue;
    const leaves = leavesOf(node);
    carried.push({
      layout: node,
      focus: leaves.includes(group.focus) ? group.focus : leaves[0]!,
    });
  }
  main = {
    ...main,
    tabs: [...main.tabs, ...gone.tabs.filter((tab) => freshKeys.has(tab.key))],
    groups: [...main.groups, ...carried],
  };
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
    ...layout,
    active: layout.active === key ? MAIN_DESK : layout.active,
    desks: { ...rest, [MAIN_DESK]: settle(main) },
  };
}

/** layout 전체에서 key의 tab이 있는 desk와 자리. session 열기가 그 desk로 가는 데 쓴다. active desk를 먼저 본다. */
export function findTab(
  layout: WorkspaceLayout,
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
  layout: WorkspaceLayout,
  tab: TabItem,
  options?: OpenOptions,
): WorkspaceLayout {
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
export function allTabs(layout: WorkspaceLayout): TabItem[] {
  return Object.values(layout.desks).flatMap(deskTabs);
}

/** 모든 desk의 모든 tab에 change를 적용한다. 바뀐 것이 없으면 layout 그대로다. */
export function mapLayoutTabs(
  layout: WorkspaceLayout,
  change: (tab: TabItem) => TabItem,
): WorkspaceLayout {
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
