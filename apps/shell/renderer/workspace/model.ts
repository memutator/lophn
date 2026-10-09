// project-workspace 틀의 순수 규칙. 화면은 이 값을 그대로 그린다.
// 치수는 shell/desktop#R22, shell/editor#R3·R5, shell/design-system#R24·R25를 따른다.

/** sidebar 기본 폭. drag로 200~400px, 접힘 56px(desktop#R22, design-system#R24). */
export const SIDEBAR_WIDTH = 240;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 400;
export const SIDEBAR_COLLAPSED = 56;
/** 탐색 행 높이(desktop#R22). */
export const SIDEBAR_ROW = 32;

/** 반응형 경계(design-system#R24). */
export const BREAKPOINT_SM = 640;
export const BREAKPOINT_MD = 1024;

/** 상단 바 높이(desktop#R22). */
export const TOP_BAR_HEIGHT = 48;
/** 본문 여백. 창 1024px 미만은 좌우 16px(desktop#R22). */
export const BODY_PADDING_X = 32;
export const BODY_PADDING_TOP = 24;
export const BODY_PADDING_X_NARROW = 16;

/** 탭 줄 높이(workspace#R2)와 탭 폭(editor#R3). */
export const TAB_STRIP_HEIGHT = 36;
export const TAB_MIN = 120;
export const TAB_MAX = 220;
export const TAB_PINNED = 36;
export const TAB_CLOSE = 20;

/** 칸 최소 폭·경계·잡는 영역(editor#R5, workspace#R4). */
export const PANE_MIN = 480;
export const SPLIT_DIVIDER = 1;
export const SPLIT_GRAB = 8;
export const SPLIT_EQUAL = 0.5;

/** 정보 패널이 dock되려면 남는 본문 폭(design-system#R25). */
export const INFO_PANEL_BODY_MIN = 720;
/** 정보 패널 폭. */
export const INFO_PANEL_WIDTH = 320;

export type SidebarMode = "open" | "collapsed" | "hidden";

export interface SidebarState {
  /** 사람이 drag로 고른 폭. 자동으로 다시 접지 않는다(design-system#R24). */
  readonly chosenWidth: number;
  /** 사람이 접힘 버튼을 눌렀는지. */
  readonly collapsedByUser: boolean;
}

export interface SidebarView {
  readonly mode: SidebarMode;
  /** 화면에 차지하는 폭. hidden은 0. */
  readonly width: number;
  /** 런처 복귀를 상단 바로 옮겨야 하는지(desktop#R26). */
  readonly launcherInTopBar: boolean;
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
    return { mode: "hidden", width: 0, launcherInTopBar: true };
  }
  const collapsed = state.collapsedByUser ||
    (!userChoseWidth && windowWidth < BREAKPOINT_MD);
  if (collapsed) {
    return {
      mode: "collapsed",
      width: SIDEBAR_COLLAPSED,
      launcherInTopBar: true,
    };
  }
  return {
    mode: "open",
    width: clampSidebar(state.chosenWidth),
    launcherInTopBar: false,
  };
}

/** drag 폭을 200~400px로 가둔다. */
export function clampSidebar(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}

/** 본문 좌우 여백. 창 1024px 미만은 16px다(desktop#R22). */
export function bodyPaddingX(windowWidth: number): number {
  return windowWidth < BREAKPOINT_MD ? BODY_PADDING_X_NARROW : BODY_PADDING_X;
}

export type TabKind =
  | "document_editor"
  | "document_viewer"
  | "terminal"
  | "app_panel";

/** 탭 종류를 구별하는 글자 라벨의 wording key(workspace#R1). */
export const TAB_KIND_LABEL: Record<
  TabKind,
  | "project-workspace.label.kind-document-editor"
  | "project-workspace.label.kind-document-viewer"
  | "project-workspace.label.kind-terminal"
  | "project-workspace.label.kind-app-panel"
> = {
  document_editor: "project-workspace.label.kind-document-editor",
  document_viewer: "project-workspace.label.kind-document-viewer",
  terminal: "project-workspace.label.kind-terminal",
  app_panel: "project-workspace.label.kind-app-panel",
};

export interface TabItem {
  readonly key: string;
  readonly kind: TabKind;
  readonly title: string;
  /** 고정 탭은 36px로 접는다(editor#R3). */
  readonly pinned?: boolean;
  /** terminal 탭의 시작 폴더 참조. 사람이 다시 시작할 때 쓴다(workspace#R7). */
  readonly folder?: string;
  /** 앱 패널 탭의 앱과 panel 크기를 선언한 화면. 고르기 전에는 없다(workspace#R5). */
  readonly app?: string;
  readonly screen?: string;
  /** 문서 탭의 읽던 위치. 저장할 때 section key와 scroll offset만 남긴다. */
  readonly readPosition?: {
    readonly section: string;
    readonly scroll_offset: number;
  };
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
}

/** 칸이 비면 선택을 지우고, 선택 탭이 없으면 첫 탭을 고른다. */
export function normalizePane(pane: PaneState): PaneState {
  if (pane.tabs.length === 0) return { tabs: [], selected: null };
  const selected = pane.tabs.some((tab) => tab.key === pane.selected)
    ? pane.selected
    : pane.tabs[0]!.key;
  return { tabs: pane.tabs, selected };
}

/**
 * 탭을 다른 칸으로 옮긴다(workspace#R3). 원본 칸의 순서에서 빼고 대상 칸 끝에
 * 붙인다. 옮긴 탭이 선택이 되고 focus는 대상 칸으로 간다.
 */
export function moveTab(
  view: WorkspaceView,
  key: string,
  toPane: number,
): WorkspaceView {
  // 한 칸에서 오른쪽으로 옮기면 새 칸을 연다. 탭이 하나뿐이면 나눌 것이 없다.
  if (toPane === 1 && view.panes.length === 1) {
    if (view.panes[0]!.tabs.length < 2) return view;
    view = { ...view, panes: [...view.panes, { tabs: [], selected: null }] };
  }
  if (toPane < 0 || toPane >= view.panes.length) return view;
  const fromPane = view.panes.findIndex((pane) =>
    pane.tabs.some((tab) => tab.key === key)
  );
  if (fromPane < 0 || fromPane === toPane) return view;
  const tab = view.panes[fromPane]!.tabs.find((item) => item.key === key)!;
  const panes = view.panes.map((pane, index) => {
    if (index === fromPane) {
      return normalizePane({
        tabs: pane.tabs.filter((item) => item.key !== key),
        selected: pane.selected,
      });
    }
    if (index === toPane) {
      return { tabs: [...pane.tabs, tab], selected: key };
    }
    return pane;
  });
  const moved = { ...view, panes, focusedPane: toPane };
  const kept = dropEmptyPane(moved);
  return kept === moved ? moved : { ...kept, focusedPane: 0 };
}

/**
 * 넘치는 탭 줄의 scroll offset. 선택 탭의 [start, end)가 줄 안에 들어오게 가두고
 * 페이지 가로 scroll은 만들지 않는다(workspace#R2). 탭 폭은 내용에 따라 120~220px라서
 * 화면이 잰 위치를 넘긴다.
 */
export function revealScroll(
  start: number,
  end: number,
  viewport: number,
  current: number,
  contentWidth: number,
): number {
  const max = Math.max(0, contentWidth - viewport);
  let scroll = Math.min(Math.max(0, current), max);
  if (end - scroll > viewport) scroll = end - viewport;
  if (start < scroll) scroll = start;
  return Math.min(Math.max(0, scroll), max);
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
        selected: item.selected === key
          ? neighbourOf(item.tabs, key)
          : item.selected,
      })
      : item
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

/**
 * 한 칸의 선택 탭을 새 오른쪽 칸으로 보낸다(workspace#R3). 탭이 둘 이상일 때만
 * 나눈다. 이미 두 칸이면 그대로다.
 */
export function splitPane(view: WorkspaceView): WorkspaceView {
  if (view.panes.length !== 1) return view;
  const selected = view.panes[0]!.selected;
  return selected === null ? view : moveTab(view, selected, 1);
}

export interface SplitLayout {
  /** 화면에 그릴 칸 수. 폭이 부족하면 1이다(workspace#R4). */
  readonly visiblePanes: 1 | 2;
  /** 왼쪽 칸 폭. 한 칸 보기에서는 전체 폭. */
  readonly leftWidth: number;
  readonly rightWidth: number;
  /** 한 칸 보기에서 보이는 칸. focus 칸이다. */
  readonly shownPane: number;
}

/**
 * 두 칸을 그릴 폭이 있는지. 각 칸 480px와 경계 1px가 필요하다(editor#R5).
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

export type InfoPanelPlacement = "docked" | "overlay" | "hidden";

/**
 * 정보 패널 자리. 본문 720px 또는 두 칸과 경계를 남길 때만 dock하고 아니면
 * overlay다(design-system#R25). 닫혀 있으면 hidden이다.
 */
export function infoPanelPlacement(
  open: boolean,
  bodyWidth: number,
  paneCount: number,
): InfoPanelPlacement {
  if (!open) return "hidden";
  if (paneCount >= 2) {
    return bodyWidth >= PANE_MIN * 2 + SPLIT_DIVIDER + INFO_PANEL_BODY_MIN
      ? "docked"
      : "overlay";
  }
  return bodyWidth >= INFO_PANEL_BODY_MIN ? "docked" : "overlay";
}

/** 상단 경로의 한 조각. focus 칸의 활성 탭을 따른다. */
export interface Crumb {
  readonly label: string;
}

/** focus 칸 활성 탭의 경로. 프로젝트 이름 뒤에 탭 제목이 온다. */
export function breadcrumbs(
  projectTitle: string,
  view: WorkspaceView,
): readonly Crumb[] {
  const pane = view.panes[view.focusedPane];
  const tab = pane?.tabs.find((item) => item.key === pane.selected);
  const crumbs: Crumb[] = [{ label: projectTitle }];
  if (tab) crumbs.push({ label: tab.title });
  return crumbs;
}

/** drag 결과. overlay pointer DTO(ipc/overlay)의 drag-end·drag-cancel에 대응한다. */
export type DragOutcome =
  | { type: "drag-end"; x: number; y: number }
  | { type: "drag-cancel" };

/**
 * drag 연결(shell#T10). drag-end의 마지막 DTO만 적용하고 drag-cancel은 버린다.
 * 실제 앱 native bounds 적용은 T39가 맡는다.
 */
export function applyDrag<T>(
  start: T,
  last: T,
  outcome: DragOutcome,
): T {
  return outcome.type === "drag-end" ? last : start;
}
