// project-workspace 틀의 순수 규칙. 화면은 이 값을 그대로 그린다.
// 치수는 shell/desktop, shell/editor, shell/design-system 문서를 따른다.

/** sidebar 기본 폭. drag로 200~400px, 접힘 56px. */
export const SIDEBAR_WIDTH = 240;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_COLLAPSED = 56;

/** 반응형 경계. */
const BREAKPOINT_SM = 640;
export const BREAKPOINT_MD = 1024;

/** 칸 최소 폭·경계·잡는 영역. */
const PANE_MIN = 480;
const SPLIT_DIVIDER = 1;
export const SPLIT_EQUAL = 0.5;

type SidebarMode = "open" | "collapsed" | "hidden";

export interface SidebarState {
  /** 사람이 drag로 고른 폭. 자동으로 다시 접지 않는다. */
  readonly chosenWidth: number;
  /** 사람이 접힘 버튼을 눌렀는지. */
  readonly collapsedByUser: boolean;
}

interface SidebarView {
  readonly mode: SidebarMode;
  /** 화면에 차지하는 폭. hidden은 0. */
  readonly width: number;
}

/**
 * 창 폭으로 sidebar 표시를 정한다. 640px 미만은 숨기고 640~1023px는 기본 접힘이다.
 * 사람이 drag로 폭을 골랐거나 접힘을 풀었으면 창이 좁아져도 그 선택을 덮지 않는다.
 */
export function sidebarView(
  windowWidth: number,
  state: SidebarState,
  userChoseWidth: boolean,
): SidebarView {
  if (windowWidth < BREAKPOINT_SM) {
    return { mode: "hidden", width: 0 };
  }
  const collapsed =
    state.collapsedByUser || (!userChoseWidth && windowWidth < BREAKPOINT_MD);
  if (collapsed) {
    return { mode: "collapsed", width: SIDEBAR_COLLAPSED };
  }
  return { mode: "open", width: clampSidebar(state.chosenWidth) };
}

/** drag 폭을 200~400px로 가둔다. */
export function clampSidebar(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}

/** 탭 종류의 이름. 등록된 kind는 kinds/registry.ts가 정한다. */
type TabKind = string;

export interface TabItem {
  readonly key: string;
  readonly kind: TabKind;
  readonly title: string;
  /** terminal 탭의 시작 폴더 참조. 사람이 다시 시작할 때 쓴다. */
  readonly folder?: string;
  /** 앱 패널 탭의 앱과 panel 크기를 선언한 화면. 고르기 전에는 없다. */
  readonly app?: string;
  readonly screen?: string;
  /** 위 필드에 없는 kind의 layout 값. 이 값이 무엇인지는 그 kind의 선언이 안다. */
  readonly fields?: Readonly<Record<string, unknown>>;
  /** 문서 탭의 읽던 위치. 저장할 때 section key와 scroll offset만 남긴다. */
  readonly readPosition?: {
    readonly section: string;
    readonly scroll_offset: number;
  };
  /**
   * preview 탭. 칸마다 하나이고 다음 preview가 이 자리를 바꿔 쓴다. layout 파일에 남기지 않아서
   * 다시 열면 모두 고정 탭이다.
   */
  readonly preview?: boolean;
  /** popup 같은 잠깐 떴다 사라지는 탭. 저장하지 않는다. dockTab·attachDetached가 지운다. */
  readonly transient?: boolean;
}

export interface PaneState {
  readonly tabs: readonly TabItem[];
  readonly selected: string | null;
}

export interface WorkspaceView {
  readonly panes: readonly PaneState[];
  /** 왼쪽 칸 비율. 0보다 크고 1보다 작다. */
  readonly splitRatio: number;
  readonly focusedPane: number;
  /** workspace 위에 뜬 패널. 배열 순서가 위아래 순서다(마지막이 맨 위). */
  readonly floats: readonly FloatItem[];
  /** workspace 밖 OS 창으로 뗀 탭. 배열 순서는 뗀 순서다. */
  readonly detached: readonly DetachedItem[];
}

/** workspace `.content` 왼쪽 위를 (0,0)으로 한 CSS px 정수 사각형. */
export interface FloatRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 창 bounds. OS 화면 좌표 정수 사각형이다. FloatRect와 모양은 같지만 기준이 `.content`가 아니라 화면이다. */
export interface DetachedBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** detached 창 하나가 가진 탭. 배열 순서는 뗀 순서다. */
export interface DetachedItem {
  readonly tab: TabItem;
  readonly bounds: DetachedBounds;
}

/** floats 층이 차지하는 칸. `.content`의 크기다. */
export interface FloatArea {
  readonly width: number;
  readonly height: number;
}

export interface FloatItem {
  readonly tab: TabItem;
  /** minimized여도 접기 전 rect를 지킨다. */
  readonly rect: FloatRect;
  readonly minimized: boolean;
  /** 떠 온 pane 번호. dockTab이 쓴다. */
  readonly originPane: number;
  /**
   * 탭 menu의 Minimize로 칸에서 바로 접은 탭이 그 칸에서 있던 자리. 있으면 복원과 Dock이 floating이 아니라
   * 이 자리로 돌려놓는다. 사람은 접었다 편 것으로 보지 떠 있는 창을 만든 것으로 보지 않는다.
   */
  readonly dockedAt?: number;
}

export const FLOAT_MIN: FloatArea = { width: 320, height: 200 };
export type FloatEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** 칸이 비면 선택을 지우고, 선택 탭이 없으면 첫 탭을 고른다. */
export function normalizePane(pane: PaneState): PaneState {
  if (pane.tabs.length === 0) return { tabs: [], selected: null };
  const selected = pane.tabs.some((tab) => tab.key === pane.selected)
    ? pane.selected
    : pane.tabs[0]!.key;
  return { tabs: pane.tabs, selected };
}

/**
 * 탭을 옮긴다. 원본 칸에서 빼고 대상 칸의 `before` 탭 앞에 넣는다(없으면 끝). 같은 칸이어도
 * `before`를 주면 순서만 바꾼다. 옮긴 탭이 선택이 되고 focus는 대상 칸으로 간다. 옮긴 탭은 고정 탭이 된다.
 */
export function moveTab(
  view: WorkspaceView,
  key: string,
  toPane: number,
  before?: string | null,
): WorkspaceView {
  // floated 탭은 먼저 칸에 넣는다. 그 탭뿐인 한 칸에서는 나눌 것이 없어 pane 0에 둔다.
  if (isFloated(view, key)) {
    view = dockTab(view, key);
    if (
      toPane === 1 &&
      view.panes.length === 1 &&
      view.panes[0]!.tabs.length < 2
    ) {
      toPane = 0;
    }
  }
  // 한 칸에서 오른쪽으로 옮기면 새 칸을 연다. 탭이 하나뿐이면 나눌 것이 없다.
  if (toPane === 1 && view.panes.length === 1) {
    if (view.panes[0]!.tabs.length < 2) return view;
    view = { ...view, panes: [...view.panes, { tabs: [], selected: null }] };
  }
  if (toPane < 0 || toPane >= view.panes.length) return view;
  const fromPane = holderOf(view, key);
  if (fromPane < 0 || (fromPane === toPane && before === undefined)) {
    return view;
  }
  if (before === key) return view;
  const found = view.panes[fromPane]!.tabs.find((item) => item.key === key)!;
  const tab = { ...found, preview: false };
  const panes = view.panes.map((pane, index) => {
    const rest =
      index === fromPane
        ? pane.tabs.filter((item) => item.key !== key)
        : pane.tabs;
    if (index === toPane) {
      const at =
        before == null ? -1 : rest.findIndex((item) => item.key === before);
      return {
        tabs:
          at < 0
            ? [...rest, tab]
            : [...rest.slice(0, at), tab, ...rest.slice(at)],
        selected: key,
      };
    }
    if (index === fromPane) {
      return normalizePane({ tabs: rest, selected: pane.selected });
    }
    return pane;
  });
  const moved = { ...view, panes, focusedPane: toPane };
  const kept = dropEmptyPane(moved);
  return kept === moved ? moved : { ...kept, focusedPane: 0 };
}

/** 탭을 같은 칸 안에서 한 칸 왼쪽(-1)이나 오른쪽(1)으로 옮긴다. 끝이면 그대로다. */
export function shiftTab(
  view: WorkspaceView,
  pane: number,
  key: string,
  delta: -1 | 1,
): WorkspaceView {
  const tabs = view.panes[pane]?.tabs ?? [];
  const at = tabs.findIndex((tab) => tab.key === key);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= tabs.length) return view;
  const rest = tabs.filter((tab) => tab.key !== key);
  return moveTab(view, key, pane, rest[to]?.key ?? null);
}

/**
 * 탭을 이웃 칸으로 옮긴다(-1 왼쪽, 1 오른쪽). 한 칸이면 나눠서 옮기고, 왼쪽으로 나누면 새 칸이
 * 왼쪽에 선다. 이미 끝 칸이면 그대로다.
 */
export function moveTabBy(
  view: WorkspaceView,
  key: string,
  delta: -1 | 1,
): WorkspaceView {
  const from = holderOf(view, key);
  if (from < 0) return view;
  if (view.panes.length === 1) {
    const split = moveTab(view, key, 1);
    if (split === view || delta === 1) return split;
    return {
      ...split,
      panes: [...split.panes].reverse(),
      splitRatio: 1 - split.splitRatio,
      focusedPane: 0,
    };
  }
  const to = from + delta;
  return to < 0 || to >= view.panes.length ? view : moveTab(view, key, to);
}

export type PaneDropZone = "center" | "left" | "right";

/**
 * 탭을 칸 본문에 놓는다. 한 칸이면 left·right가 칸을 나누고 center는 그 칸에서 탭을 고른다. 두 칸이면
 * 왼쪽 칸에서는 right만 오른쪽 칸으로, 오른쪽 칸에서는 left만 왼쪽 칸으로 보내고 나머지는 놓은 칸에 둔다.
 * floated(minimized 포함) 탭은 먼저 칸에 넣는다.
 */
export function dropTabOnPane(
  view: WorkspaceView,
  key: string,
  pane: number,
  zone: PaneDropZone,
): WorkspaceView {
  if (isFloated(view, key)) view = dockTab(view, key);
  const from = holderOf(view, key);
  if (from < 0) return view;
  if (view.panes.length === 1) {
    if (zone === "right") return moveTab(view, key, 1);
    if (zone === "left") return moveTabBy(view, key, -1);
  }
  const target =
    view.panes.length === 1
      ? 0
      : pane === 0
        ? zone === "right"
          ? 1
          : 0
        : zone === "left"
          ? 0
          : 1;
  if (target !== from) return moveTab(view, key, target);
  return {
    ...view,
    focusedPane: target,
    panes: view.panes.map((item, index) =>
      index === target
        ? {
            tabs: item.tabs.map((tab) =>
              tab.key === key ? { ...tab, preview: false } : tab,
            ),
            selected: key,
          }
        : item,
    ),
  };
}

/**
 * 닫은 탭을 닫기 전 칸의 그 자리에 다시 연다(칸이 줄었으면 마지막 칸). 이미 열려 있는 탭이면
 * 그대로다. 다시 연 탭은 고정 탭이다.
 */
export function reopenTab(
  view: WorkspaceView,
  tab: TabItem,
  pane: number,
  index: number,
): WorkspaceView {
  if (findTab(view, tab.key) !== undefined) return view;
  const target = Math.min(Math.max(pane, 0), view.panes.length - 1);
  const reopened = { ...tab, preview: false };
  return {
    ...view,
    focusedPane: target,
    panes: view.panes.map((item, at) => {
      if (at !== target) return item;
      const tabs = [...item.tabs];
      tabs.splice(Math.min(index, tabs.length), 0, reopened);
      return { tabs, selected: tab.key };
    }),
  };
}

// pane 전용이다. floats까지 보려면 findTab.
function holderOf(view: WorkspaceView, key: string): number {
  return view.panes.findIndex((pane) =>
    pane.tabs.some((tab) => tab.key === key),
  );
}

/**
 * 탭을 focus 칸에 열고 고른다. 이미 어느 칸에 있으면 새로 붙이지 않고 그 칸에서 고르고, 고정으로
 * 여는 길(preview가 아닌 탭)이면 preview를 푼다. preview 탭은 그 칸의 preview 자리를 바꿔 쓰되,
 * 저장 안 된 변경이 있는 탭은 사라지지 않게 고정 탭으로 남기고 새 preview를 뒤에 붙인다.
 * `after` 탭이 칸에 있으면 새 탭은 그 칸의 그 탭 바로 뒤에 붙는다(없으면 focus 칸 끝).
 */
export function openTabIn(
  view: WorkspaceView,
  tab: TabItem,
  isUnsaved: (key: string) => boolean,
  after?: string,
): WorkspaceView {
  // detached 탭은 새로 붙이지 않는다. 그 창을 앞으로 가져오는 일은 호출하는 쪽이 한다.
  if (isDetached(view, tab.key)) return view;
  if (isFloated(view, tab.key)) return restoreFloat(view, tab.key);
  const holder = holderOf(view, tab.key);
  const afterHolder = after === undefined ? -1 : holderOf(view, after);
  const target =
    holder >= 0 ? holder : afterHolder >= 0 ? afterHolder : view.focusedPane;
  const panes = view.panes.map((pane, index) => {
    if (index !== target) return pane;
    if (holder >= 0) {
      return {
        tabs:
          tab.preview === true
            ? pane.tabs
            : pane.tabs.map((item) =>
                item.key === tab.key && item.preview
                  ? { ...item, preview: false }
                  : item,
              ),
        selected: tab.key,
      };
    }
    const old =
      tab.preview === true
        ? pane.tabs.find((item) => item.preview === true)
        : undefined;
    if (old === undefined) {
      const at = pane.tabs.findIndex((item) => item.key === after);
      return {
        tabs:
          at < 0
            ? [...pane.tabs, tab]
            : [...pane.tabs.slice(0, at + 1), tab, ...pane.tabs.slice(at + 1)],
        selected: tab.key,
      };
    }
    if (!isUnsaved(old.key)) {
      return {
        tabs: pane.tabs.map((item) => (item.key === old.key ? tab : item)),
        selected: tab.key,
      };
    }
    return {
      tabs: [
        ...pane.tabs.map((item) =>
          item.key === old.key ? { ...item, preview: false } : item,
        ),
        tab,
      ],
      selected: tab.key,
    };
  });
  return { ...view, focusedPane: target, panes };
}

/** preview 탭을 고정 탭으로 만든다(탭 double-click, 내용을 고침). */
export function pinTab(view: WorkspaceView, key: string): WorkspaceView {
  if (
    !view.panes.some((pane) =>
      pane.tabs.some((tab) => tab.key === key && tab.preview),
    )
  )
    return view;
  return {
    ...view,
    panes: view.panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) =>
        tab.key === key ? { ...tab, preview: false } : tab,
      ),
    })),
  };
}

export type CloseScope = "others" | "right" | "saved" | "all";

/**
 * 탭 menu의 Close Others·Close to the Right·Close Saved·Close All이 닫으려는 탭. 저장 안 된 탭은
 * Close Saved에서 빠진다. 나머지는 탭마다 닫기 확인(beforeClose)을 거치므로 여기서 거르지 않는다.
 */
export function closeTargets(
  pane: PaneState,
  scope: CloseScope,
  key: string,
  isUnsaved: (key: string) => boolean,
): string[] {
  const at = pane.tabs.findIndex((tab) => tab.key === key);
  const keys = pane.tabs.map((tab) => tab.key);
  switch (scope) {
    case "others":
      return keys.filter((item) => item !== key);
    case "right":
      return at < 0 ? [] : keys.slice(at + 1);
    case "saved":
      return keys.filter((item) => !isUnsaved(item));
    case "all":
      return keys;
  }
}

/** 칸 안에서 delta만큼 떨어진 탭. 끝에서 반대쪽으로 돈다. */
export function stepTab(pane: PaneState, delta: number): string | null {
  const count = pane.tabs.length;
  if (count === 0) return null;
  const at = Math.max(
    0,
    pane.tabs.findIndex((tab) => tab.key === pane.selected),
  );
  return pane.tabs[(at + delta + count) % count]!.key;
}

/** 탭을 닫는다. 두 칸 중 한 칸이 비면 남은 칸 하나로 돌아간다. */
export function closeTab(
  view: WorkspaceView,
  pane: number,
  key: string,
): WorkspaceView {
  const panes = view.panes.map((item, index) =>
    index === pane
      ? normalizePane({
          tabs: item.tabs.filter((tab) => tab.key !== key),
          selected:
            item.selected === key ? neighbourOf(item.tabs, key) : item.selected,
        })
      : item,
  );
  return dropEmptyPane({ ...view, panes });
}

// 닫은 탭 자리에서 오른쪽, 없으면 왼쪽 탭을 고른다.
function neighbourOf(tabs: readonly TabItem[], key: string): string | null {
  const index = tabs.findIndex((tab) => tab.key === key);
  const next = tabs[index + 1] ?? tabs[index - 1];
  return next ? next.key : null;
}

function dropEmptyPane(view: WorkspaceView): WorkspaceView {
  if (view.panes.length < 2) return view;
  const kept = view.panes.filter((pane) => pane.tabs.length > 0);
  if (kept.length === view.panes.length) return view;
  if (kept.length === 0) {
    return { ...view, panes: [{ tabs: [], selected: null }], focusedPane: 0 };
  }
  return { ...view, panes: kept, focusedPane: 0 };
}

const FLOAT_SHARE = 0.6;

function newFloat(
  tab: TabItem,
  area: FloatArea,
  originPane: number,
  size?: FloatArea,
): FloatItem {
  // 크기를 먼저 최소·area 안으로 맞춘 뒤 그 크기로 가운데에 둔다.
  const { width, height } = clampFloatRect(
    {
      x: 0,
      y: 0,
      width: size?.width ?? area.width * FLOAT_SHARE,
      height: size?.height ?? area.height * FLOAT_SHARE,
    },
    area,
  );
  const rect = clampFloatRect(
    {
      x: Math.round((area.width - width) / 2),
      y: Math.round((area.height - height) / 2),
      width,
      height,
    },
    area,
  );
  return { tab, rect, minimized: false, originPane };
}

/**
 * 새 탭을 곧바로 floated로 연다(popup용). size를 주면 그 크기로 가운데에 열고(최소 크기와
 * area 안으로 맞춘다) 없으면 area의 60%다. 같은 key가 이미 있으면 그대로다.
 */
export function openFloat(
  view: WorkspaceView,
  tab: TabItem,
  area: FloatArea,
  size?: FloatArea,
): WorkspaceView {
  if (findTab(view, tab.key) !== undefined) return view;
  return {
    ...view,
    floats: [...view.floats, newFloat(tab, area, view.focusedPane, size)],
  };
}

/** pane의 탭을 floated로 만든다. preview 표시를 지운다. pane에 없으면 그대로다. */
export function floatTab(
  view: WorkspaceView,
  key: string,
  area: FloatArea,
): WorkspaceView {
  const pane = holderOf(view, key);
  if (pane < 0) return view;
  const found = view.panes[pane]!.tabs.find((item) => item.key === key)!;
  const closed = closeTab(view, pane, key);
  return {
    ...closed,
    floats: [
      ...closed.floats,
      newFloat({ ...found, preview: false }, area, pane),
    ],
  };
}

/**
 * floated 탭을 떠 온 pane에 넣고 고른다. 칸에서 바로 접은 탭은 있던 자리, 아니면 끝이다. 그 pane이 없으면
 * focus pane.
 */
export function dockTab(view: WorkspaceView, key: string): WorkspaceView {
  const item = view.floats.find((float) => float.tab.key === key);
  if (item === undefined) return view;
  const target =
    item.originPane < view.panes.length ? item.originPane : view.focusedPane;
  const { transient: _transient, ...rest } = item.tab;
  const tab = { ...rest, preview: false };
  return {
    ...view,
    focusedPane: target,
    panes: view.panes.map((pane, index) => {
      if (index !== target) return pane;
      const at = Math.min(item.dockedAt ?? pane.tabs.length, pane.tabs.length);
      return {
        tabs: [...pane.tabs.slice(0, at), tab, ...pane.tabs.slice(at)],
        selected: key,
      };
    }),
    floats: view.floats.filter((float) => float.tab.key !== key),
  };
}

/** 칸의 탭을 바로 접는다. 복원하면 floating이 아니라 그 칸의 같은 자리로 돌아간다. */
export function minimizeTab(
  view: WorkspaceView,
  key: string,
  area: FloatArea,
): WorkspaceView {
  const pane = holderOf(view, key);
  if (pane < 0) return view;
  const dockedAt = view.panes[pane]!.tabs.findIndex((item) => item.key === key);
  const floated = floatTab(view, key, area);
  return {
    ...floated,
    floats: floated.floats.map((float) =>
      float.tab.key === key ? { ...float, minimized: true, dockedAt } : float,
    ),
  };
}

function changeFloat(
  view: WorkspaceView,
  key: string,
  change: (item: FloatItem) => FloatItem,
): WorkspaceView {
  const at = view.floats.findIndex((float) => float.tab.key === key);
  if (at < 0) return view;
  const item = view.floats[at]!;
  const next = change(item);
  if (next === item) return view;
  return {
    ...view,
    floats: view.floats.map((float, index) => (index === at ? next : float)),
  };
}

export function minimizeFloat(view: WorkspaceView, key: string): WorkspaceView {
  return changeFloat(view, key, (item) =>
    item.minimized ? item : { ...item, minimized: true },
  );
}

/** minimized를 풀고 맨 위로 올린다. 칸에서 바로 접은 탭은 그 칸의 있던 자리로 돌아간다. */
export function restoreFloat(view: WorkspaceView, key: string): WorkspaceView {
  const item = view.floats.find((float) => float.tab.key === key);
  if (item === undefined) return view;
  if (item.dockedAt !== undefined) return dockTab(view, key);
  const top = view.floats[view.floats.length - 1] === item;
  if (!item.minimized && top) return view;
  return {
    ...view,
    floats: [
      ...view.floats.filter((float) => float !== item),
      { ...item, minimized: false },
    ],
  };
}

/** 맨 위로 올린다. 이미 맨 위면 같은 참조다. */
export function raiseFloat(view: WorkspaceView, key: string): WorkspaceView {
  const item = view.floats.find((float) => float.tab.key === key);
  if (item === undefined || view.floats[view.floats.length - 1] === item) {
    return view;
  }
  return {
    ...view,
    floats: [...view.floats.filter((float) => float !== item), item],
  };
}

export function closeFloat(view: WorkspaceView, key: string): WorkspaceView {
  if (!isFloated(view, key)) return view;
  return { ...view, floats: view.floats.filter((f) => f.tab.key !== key) };
}

/**
 * pane이나 floats의 탭을 detached로 만든다(배열 끝). preview 표시를 지운다. transient는 그대로 두고
 * attach할 때 지운다. pane에서 빠진 칸 정리는 closeTab과 같다. 이미 detached이거나 없으면 그대로다.
 */
export function detachTab(
  view: WorkspaceView,
  key: string,
  bounds: DetachedBounds,
): WorkspaceView {
  const pane = holderOf(view, key);
  if (pane >= 0) {
    const found = view.panes[pane]!.tabs.find((item) => item.key === key)!;
    const closed = closeTab(view, pane, key);
    return {
      ...closed,
      detached: [
        ...closed.detached,
        {
          tab: { ...found, preview: false },
          bounds,
        },
      ],
    };
  }
  const float = view.floats.find((item) => item.tab.key === key);
  if (float === undefined) return view;
  return {
    ...view,
    floats: view.floats.filter((item) => item !== float),
    detached: [
      ...view.detached,
      {
        tab: { ...float.tab, preview: false },
        bounds,
      },
    ],
  };
}

/** 새 탭을 곧바로 detached로 연다(detached 창 안에서 열린 popup). 같은 key가 이미 있으면 그대로다. */
export function openDetachedTab(
  view: WorkspaceView,
  tab: TabItem,
  bounds: DetachedBounds,
): WorkspaceView {
  if (findTab(view, tab.key) !== undefined) return view;
  return { ...view, detached: [...view.detached, { tab, bounds }] };
}

/**
 * detached 탭을 focus pane 끝에 넣고 고른다. preview·transient 표시를 지운다. tab을 주면 detached
 * 창에서 바뀐 그 값으로 바꿔 붙인다.
 */
export function attachDetached(
  view: WorkspaceView,
  key: string,
  tab?: TabItem,
): WorkspaceView {
  const item = view.detached.find((detached) => detached.tab.key === key);
  if (item === undefined) return view;
  const { transient: _transient, ...rest } = tab ?? item.tab;
  const attached = { ...rest, preview: false };
  return {
    ...view,
    panes: view.panes.map((pane, index) =>
      index === view.focusedPane
        ? { tabs: [...pane.tabs, attached], selected: key }
        : pane,
    ),
    detached: view.detached.filter((detached) => detached !== item),
  };
}

/** detached 항목을 버린다(탭을 닫는다). */
export function closeDetached(view: WorkspaceView, key: string): WorkspaceView {
  if (!isDetached(view, key)) return view;
  return {
    ...view,
    detached: view.detached.filter((item) => item.tab.key !== key),
  };
}

export function setFloatRect(
  view: WorkspaceView,
  key: string,
  rect: FloatRect,
  area: FloatArea,
): WorkspaceView {
  const clamped = clampFloatRect(rect, area);
  return changeFloat(view, key, (item) => {
    const same =
      item.rect.x === clamped.x &&
      item.rect.y === clamped.y &&
      item.rect.width === clamped.width &&
      item.rect.height === clamped.height;
    return same ? item : { ...item, rect: clamped };
  });
}

/** area 안으로 당긴다. 크기는 FLOAT_MIN 이상(area가 더 작으면 area), 위치는 area 안. */
export function clampFloatRect(rect: FloatRect, area: FloatArea): FloatRect {
  const width = Math.min(
    area.width,
    Math.max(FLOAT_MIN.width, Math.round(rect.width)),
  );
  const height = Math.min(
    area.height,
    Math.max(FLOAT_MIN.height, Math.round(rect.height)),
  );
  return {
    x: Math.min(area.width - width, Math.max(0, Math.round(rect.x))),
    y: Math.min(area.height - height, Math.max(0, Math.round(rect.y))),
    width,
    height,
  };
}

/** 패널 이동. start에서 (dx,dy)만큼 옮긴 사각형을 area 안으로 가둔다. */
export function movedRect(
  start: FloatRect,
  dx: number,
  dy: number,
  area: FloatArea,
): FloatRect {
  return clampFloatRect({ ...start, x: start.x + dx, y: start.y + dy }, area);
}

/** 가장자리·모서리 resize. 반대쪽 가장자리를 고정하고 FLOAT_MIN과 area 안으로 가둔다. */
export function resizedRect(
  start: FloatRect,
  edge: FloatEdge,
  dx: number,
  dy: number,
  area: FloatArea,
): FloatRect {
  const minW = Math.min(FLOAT_MIN.width, area.width);
  const minH = Math.min(FLOAT_MIN.height, area.height);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (edge.includes("w")) left = Math.min(Math.max(left + dx, 0), right - minW);
  if (edge.includes("e")) {
    right = Math.max(Math.min(right + dx, area.width), left + minW);
  }
  if (edge.includes("n")) top = Math.min(Math.max(top + dy, 0), bottom - minH);
  if (edge.includes("s")) {
    bottom = Math.max(Math.min(bottom + dy, area.height), top + minH);
  }
  return clampFloatRect(
    { x: left, y: top, width: right - left, height: bottom - top },
    area,
  );
}

/** pane, floats, detached를 모두 본다. */
export function findTab(view: WorkspaceView, key: string): TabItem | undefined {
  return allTabs(view).find((tab) => tab.key === key);
}

export function isFloated(view: WorkspaceView, key: string): boolean {
  return view.floats.some((float) => float.tab.key === key);
}

export function isDetached(view: WorkspaceView, key: string): boolean {
  return view.detached.some((item) => item.tab.key === key);
}

/** panes 순서, 그 뒤 floats, 그 뒤 detached 순서. */
export function allTabs(view: WorkspaceView): TabItem[] {
  return [
    ...view.panes.flatMap((pane) => pane.tabs),
    ...view.floats.map((float) => float.tab),
    ...view.detached.map((item) => item.tab),
  ];
}

/** panes, floats, detached의 모든 탭에 change를 적용한다. 바뀐 것이 없으면 view 그대로다. */
export function mapTabs(
  view: WorkspaceView,
  change: (tab: TabItem) => TabItem,
): WorkspaceView {
  let changed = false;
  const apply = (tab: TabItem) => {
    const next = change(tab);
    if (next !== tab) changed = true;
    return next;
  };
  const panes = view.panes.map((pane) => ({
    ...pane,
    tabs: pane.tabs.map(apply),
  }));
  const floats = view.floats.map((float) => ({
    ...float,
    tab: apply(float.tab),
  }));
  const detached = view.detached.map((item) => ({
    ...item,
    tab: apply(item.tab),
  }));
  return changed ? { ...view, panes, floats, detached } : view;
}

/**
 * 저장할 view. transient 탭을 panes, floats, detached에서 뺀다. 빠진 탭이 선택이었으면 normalizePane이
 * 다른 탭을 고르고, 칸이 비면 칸을 접는다.
 */
export function storableView(view: WorkspaceView): WorkspaceView {
  if (!allTabs(view).some((tab) => tab.transient === true)) return view;
  const panes = view.panes.map((pane) =>
    normalizePane({
      tabs: pane.tabs.filter((tab) => tab.transient !== true),
      selected: pane.selected,
    }),
  );
  return dropEmptyPane({
    ...view,
    panes,
    floats: view.floats.filter((float) => float.tab.transient !== true),
    detached: view.detached.filter((item) => item.tab.transient !== true),
  });
}

// 자리(desk) 층. 아래 함수는 위의 WorkspaceView 함수를 부르기만 한다.

/** slug가 될 수 없는 값이다(`_`로 시작). workflow 이름과 겹치지 않는다. */
export const DEFAULT_DESK = "_default";

// main/workspace/schema.ts의 상한과 같다. 넘기면 schema가 저장을 통째로 거절한다.
const DESK_FLOATS_MAX = 20;
const DESK_DETACHED_MAX = 20;

export interface WorkspaceDesks {
  /** 지금 보이는 자리의 key. `desks`에 늘 있다. */
  readonly active: string;
  /**
   * 자리 key → 그 자리의 WorkspaceView. `DEFAULT_DESK`는 늘 있고 합쳐서 지워지지 않는다.
   * 나머지 key는 그 project 안의 workflow 이름(slug)이다.
   */
  readonly desks: Readonly<Record<string, WorkspaceView>>;
}

export function emptyView(): WorkspaceView {
  return {
    panes: [{ tabs: [], selected: null }],
    splitRatio: SPLIT_EQUAL,
    focusedPane: 0,
    floats: [],
    detached: [],
  };
}

export function desksFromView(view: WorkspaceView): WorkspaceDesks {
  return { active: DEFAULT_DESK, desks: { [DEFAULT_DESK]: view } };
}

export function activeView(desks: WorkspaceDesks): WorkspaceView {
  return desks.desks[desks.active]!;
}

/** `key` 자리의 view만 바꾼다. 없는 자리거나 같은 view면 같은 참조다. */
export function setDeskView(
  desks: WorkspaceDesks,
  key: string,
  view: WorkspaceView,
): WorkspaceDesks {
  if (!Object.hasOwn(desks.desks, key) || desks.desks[key] === view) {
    return desks;
  }
  return { ...desks, desks: { ...desks.desks, [key]: view } };
}

/** 보이는 자리의 view만 바꾼다. */
export function setActiveView(
  desks: WorkspaceDesks,
  view: WorkspaceView,
): WorkspaceDesks {
  return setDeskView(desks, desks.active, view);
}

/** 그 key의 탭이 있는 자리. 보이는 자리를 먼저 본다. */
export function deskOfTab(
  desks: WorkspaceDesks,
  key: string,
): string | undefined {
  if (findTab(activeView(desks), key) !== undefined) return desks.active;
  return Object.entries(desks.desks).find(
    ([, view]) => findTab(view, key) !== undefined,
  )?.[0];
}

/** 자리를 건너 모든 탭. */
export function allDeskTabs(desks: WorkspaceDesks): TabItem[] {
  return Object.values(desks.desks).flatMap(allTabs);
}

// 자리마다 change를 적용한다. 바뀐 자리가 없으면 desks 그대로다.
function mapDesks(
  desks: WorkspaceDesks,
  change: (view: WorkspaceView) => WorkspaceView,
): WorkspaceDesks {
  let changed = false;
  const next: Record<string, WorkspaceView> = {};
  for (const [key, view] of Object.entries(desks.desks)) {
    next[key] = change(view);
    if (next[key] !== view) changed = true;
  }
  return changed ? { ...desks, desks: next } : desks;
}

export function mapDeskTabs(
  desks: WorkspaceDesks,
  change: (tab: TabItem) => TabItem,
): WorkspaceDesks {
  return mapDesks(desks, (view) => mapTabs(view, change));
}

export function storableDesks(desks: WorkspaceDesks): WorkspaceDesks {
  return mapDesks(desks, storableView);
}

// view에서 drop에 든 key의 탭을 뺀다. 빈 칸 정리와 선택 옮기기는 기존 닫기 함수가 한다.
function withoutKeys(
  view: WorkspaceView,
  drop: ReadonlySet<string>,
): WorkspaceView {
  let next = view;
  for (const { key } of allTabs(view)) {
    if (!drop.has(key)) continue;
    next = isDetached(next, key)
      ? closeDetached(next, key)
      : isFloated(next, key)
        ? closeFloat(next, key)
        : closeTab(next, holderOf(next, key), key);
  }
  return next;
}

/**
 * 자리를 바꾼다. 있는 자리면 `active`만 바꾸고, 없는 자리면 `seed`로 만든다. 새 자리에서는 다른
 * 자리에 이미 있는 탭을 뺀다(탭 하나는 자리를 건너서도 한 곳에만 있다).
 */
export function switchDesk(
  desks: WorkspaceDesks,
  key: string,
  seed: WorkspaceView,
): WorkspaceDesks {
  if (key === desks.active) return desks;
  if (Object.hasOwn(desks.desks, key)) return { ...desks, active: key };
  const taken = new Set(allDeskTabs(desks).map((tab) => tab.key));
  return {
    active: key,
    desks: { ...desks.desks, [key]: withoutKeys(seed, taken) },
  };
}

/**
 * openTabIn의 자리 층 판. 탭이 다른 자리에 있으면 그 자리로 가서 연다. 새 탭이면 `after`의
 * 탭이 있는 자리로 가서 그 뒤에 연다(다른 자리 terminal이 연 URL을 사람이 봐야 해서다).
 */
export function openAcrossDesks(
  desks: WorkspaceDesks,
  tab: TabItem,
  isUnsaved: (key: string) => boolean,
  after?: string,
): WorkspaceDesks {
  const at =
    deskOfTab(desks, tab.key) ??
    (after === undefined ? undefined : deskOfTab(desks, after));
  const next =
    at === undefined || at === desks.active ? desks : { ...desks, active: at };
  return setActiveView(
    next,
    openTabIn(activeView(next), tab, isUnsaved, after),
  );
}

/** `DEFAULT_DESK`가 아니고 `liveKeys`에 없는 자리 key. */
export function vanishedDesks(
  desks: WorkspaceDesks,
  liveKeys: readonly string[],
): string[] {
  return Object.keys(desks.desks).filter(
    (key) => key !== DEFAULT_DESK && !liveKeys.includes(key),
  );
}

/**
 * `key` 자리의 탭을 `DEFAULT_DESK`로 옮기고 그 자리를 지운다. docked는 focus 칸 끝, floated는
 * floats 끝, detached는 detached 끝이다. floats·detached 상한을 넘는 탭은 docked로 간다.
 * 옮긴 docked 탭의 preview는 푼다. 이미 같은 key가 있으면 옮기지 않는다.
 */
export function mergeDeskIntoDefault(
  desks: WorkspaceDesks,
  key: string,
): WorkspaceDesks {
  const gone = desks.desks[key];
  if (key === DEFAULT_DESK || gone === undefined) return desks;
  let base = desks.desks[DEFAULT_DESK]!;
  const taken = new Set(allTabs(base).map((tab) => tab.key));
  const dock = (tab: TabItem) => {
    const focus = base.focusedPane;
    base = {
      ...base,
      panes: base.panes.map((pane, index) =>
        index === focus
          ? normalizePane({
              tabs: [...pane.tabs, { ...tab, preview: false }],
              selected: pane.selected,
            })
          : pane,
      ),
    };
  };
  const fresh = (tab: TabItem) => {
    if (taken.has(tab.key)) return false;
    taken.add(tab.key);
    return true;
  };
  for (const tab of gone.panes.flatMap((pane) => pane.tabs)) {
    if (fresh(tab)) dock(tab);
  }
  for (const float of gone.floats) {
    if (!fresh(float.tab)) continue;
    if (base.floats.length >= DESK_FLOATS_MAX) {
      dock(float.tab);
      continue;
    }
    base = {
      ...base,
      floats: [
        ...base.floats,
        {
          ...float,
          tab: { ...float.tab, preview: false },
          originPane: Math.min(float.originPane, base.panes.length - 1),
        },
      ],
    };
  }
  for (const item of gone.detached) {
    if (!fresh(item.tab)) continue;
    if (base.detached.length >= DESK_DETACHED_MAX) {
      dock(item.tab);
      continue;
    }
    base = {
      ...base,
      detached: [
        ...base.detached,
        {
          ...item,
          tab: { ...item.tab, preview: false },
        },
      ],
    };
  }
  const rest = Object.fromEntries(
    Object.entries(desks.desks).filter(([name]) => name !== key),
  );
  return {
    active: desks.active === key ? DEFAULT_DESK : desks.active,
    desks: { ...rest, [DEFAULT_DESK]: base },
  };
}

interface SplitLayout {
  /** 화면에 그릴 칸 수. 폭이 부족하면 1이다. */
  readonly visiblePanes: 1 | 2;
  /** 왼쪽 칸 폭. 한 칸 보기에서는 전체 폭. */
  readonly leftWidth: number;
  readonly rightWidth: number;
  /** 한 칸 보기에서 보이는 칸. focus 칸이다. */
  readonly shownPane: number;
}

/**
 * 두 칸을 그릴 폭이 있는지. 각 칸 480px와 경계 1px가 필요하다.
 * 부족하면 저장된 비율·탭 소속을 바꾸지 않고 한 칸 보기로 표시한다.
 */
export function splitLayout(
  bodyWidth: number,
  view: WorkspaceView,
): SplitLayout {
  const twoPanes = view.panes.length === 2;
  if (!twoPanes || bodyWidth < PANE_MIN * 2 + SPLIT_DIVIDER) {
    return {
      visiblePanes: 1,
      leftWidth: bodyWidth,
      rightWidth: 0,
      shownPane: Math.min(view.focusedPane, view.panes.length - 1),
    };
  }
  const left = Math.round((bodyWidth - SPLIT_DIVIDER) * view.splitRatio);
  const clamped = Math.min(
    bodyWidth - SPLIT_DIVIDER - PANE_MIN,
    Math.max(PANE_MIN, left),
  );
  return {
    visiblePanes: 2,
    leftWidth: clamped,
    rightWidth: bodyWidth - SPLIT_DIVIDER - clamped,
    shownPane: view.focusedPane,
  };
}

/** 경계 drag로 비율을 바꾼다. 두 칸 각각 480px를 넘지 않게 가둔다. */
export function ratioFromDrag(bodyWidth: number, leftWidth: number): number {
  const usable = bodyWidth - SPLIT_DIVIDER;
  const clamped = Math.min(usable - PANE_MIN, Math.max(PANE_MIN, leftWidth));
  return clamped / usable;
}

/** 상단 경로의 한 조각(Settings의 breadcrumb이 쓴다). */
export interface Crumb {
  readonly label: string;
}

/** drag 결과. overlay pointer DTO(ipc/overlay)의 drag-end·drag-cancel에 대응한다. */
export type DragOutcome =
  | { type: "drag-end"; x: number; y: number }
  | { type: "drag-cancel" };

/**
 * drag 연결. drag-end의 마지막 DTO만 적용하고 drag-cancel은 버린다.
 */
export function applyDrag<T>(start: T, last: T, outcome: DragOutcome): T {
  return outcome.type === "drag-end" ? last : start;
}
