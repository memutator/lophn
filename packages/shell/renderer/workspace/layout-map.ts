// 화면 탭(TabItem)과 layout 파일 탭을 양쪽에서 읽는다. 단위 테스트는 title이 있는
// 옛 모양을 복원하고, 파일에 남는 것은 schema 필드뿐이다.
import {
  normalizePane,
  type PaneState,
  type TabItem,
  type WorkspaceView,
} from "./model.ts";
import { tabKindOf } from "./kinds/registry.ts";

const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

const INFO_TABS = ["info", "contexts"] as const;
type InfoTab = (typeof INFO_TABS)[number];

export interface StoredLayoutView {
  readonly view: WorkspaceView | null;
  readonly infoOpen: boolean;
  readonly infoTab: InfoTab;
}

function readPosition(value: unknown): TabItem["readPosition"] {
  if (typeof value !== "object" || value === null) return undefined;
  const section = (value as { section?: unknown }).section;
  const offset = (value as { scroll_offset?: unknown }).scroll_offset;
  if (
    typeof section !== "string" || section.length < 1 || section.length > 128
  ) {
    return undefined;
  }
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
    return undefined;
  }
  return { section, scroll_offset: offset };
}

/** 파일 탭 또는 옛 TabItem을 화면에 그린다. 맞출 수 없거나 등록되지 않은 kind면 null이다. */
export function tabFromStored(value: unknown): TabItem | null {
  if (typeof value !== "object" || value === null) return null;
  const tab = value as Record<string, unknown>;
  const kind = tabKindOf(tab.kind);
  if (
    typeof tab.key !== "string" || !TAB_KEY.test(tab.key) ||
    kind === undefined
  ) {
    return null;
  }
  const position = readPosition(tab.read_position) ??
    readPosition(tab.readPosition);
  if (typeof tab.title === "string") {
    return {
      key: tab.key,
      kind: kind.kind,
      title: tab.title,
      ...(typeof tab.folder === "string" ? { folder: tab.folder } : {}),
      ...(typeof tab.app === "string" ? { app: tab.app } : {}),
      ...(typeof tab.screen === "string" ? { screen: tab.screen } : {}),
      ...(tab.pinned === true ? { pinned: true } : {}),
      ...(position === undefined ? {} : { readPosition: position }),
    };
  }
  return kind.fromStored(tab, { key: tab.key, position });
}

/** 화면 탭을 schema 필드로 줄인다. 맞출 수 없으면 그 탭만 빠진다. */
export function toStoredTab(tab: TabItem): Record<string, unknown> | null {
  return tabKindOf(tab.kind)?.toStored(tab, {
    position: readPosition(tab.readPosition),
  }) ?? null;
}

/** 저장된 layout에서 화면이 쓰는 부분만 꺼낸다. 검증은 main이 이미 했다. */
export function viewFromStored(layout: unknown): StoredLayoutView {
  const empty: StoredLayoutView = {
    view: null,
    infoOpen: false,
    infoTab: "info",
  };
  if (typeof layout !== "object" || layout === null) return empty;
  const value = layout as {
    panes?: { tabs?: unknown[]; selected_tab?: string | null }[];
    split_ratio?: number;
    focused_pane?: number;
    information_panel?: { open?: boolean; tab?: string };
  };
  const panel = value.information_panel;
  const infoTab = INFO_TABS.find((tab) => tab === panel?.tab) ?? "info";
  const infoOpen = panel?.open === true;
  if (!Array.isArray(value.panes)) return { ...empty, infoOpen, infoTab };
  const panes: PaneState[] = value.panes.map((pane) =>
    normalizePane({
      tabs: Array.isArray(pane.tabs)
        ? pane.tabs.flatMap((tab) => {
          const item = tabFromStored(tab);
          return item === null ? [] : [item];
        })
        : [],
      selected: pane.selected_tab ?? null,
    })
  );
  const focused = typeof value.focused_pane === "number"
    ? value.focused_pane
    : 0;
  return {
    view: {
      panes,
      splitRatio: typeof value.split_ratio === "number"
        ? value.split_ratio
        : 0.5,
      focusedPane: focused >= 0 && focused < panes.length ? focused : 0,
    },
    infoOpen,
    infoTab,
  };
}

/** renderer가 main에 보내는 layout. window bounds와 schema 판은 main이 채운다. */
export function toStoredLayout(input: {
  project: string;
  view: WorkspaceView;
  informationPanel: { open: boolean; tab: InfoTab };
  lastSpace: string;
}): {
  project: string;
  last_space: string;
  panes: { tabs: Record<string, unknown>[]; selected_tab: string | null }[];
  split_ratio: number;
  focused_pane: number;
  information_panel: { open: boolean; tab: InfoTab };
} {
  const panes = input.view.panes.slice(0, 2).map((pane) => {
    const tabs = pane.tabs.flatMap((tab) => {
      const stored = toStoredTab(tab);
      return stored === null ? [] : [stored];
    });
    const selected = tabs.some((tab) => tab.key === pane.selected)
      ? pane.selected
      : null;
    return { tabs, selected_tab: selected };
  });
  const kept = panes.length > 0 ? panes : [{ tabs: [], selected_tab: null }];
  const ratio = input.view.splitRatio > 0 && input.view.splitRatio < 1
    ? input.view.splitRatio
    : 0.5;
  const focused = input.view.focusedPane >= 0 &&
      input.view.focusedPane < kept.length
    ? input.view.focusedPane
    : 0;
  return {
    project: input.project,
    last_space: input.lastSpace,
    panes: kept,
    split_ratio: ratio,
    focused_pane: focused,
    information_panel: input.informationPanel,
  };
}
