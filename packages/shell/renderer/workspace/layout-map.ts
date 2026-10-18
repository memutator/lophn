// 화면 탭(TabItem)과 layout 파일 탭을 오간다. 파일에 남는 것은 schema 필드뿐이다.
import {
  normalizePane,
  type PaneState,
  type TabItem,
  type WorkspaceView,
} from "./model.ts";
import { tabKindOf } from "./kinds/registry.ts";

// 탭 key는 kind마다 다르다. 파일 탭은 절대 경로이고 나머지는 짧은 이름이다.
const TAB_KEY_MAX = 4096;

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

/** layout 파일 탭을 화면에 그린다. 맞출 수 없거나 등록되지 않은 kind면 null이다. */
function tabFromStored(value: unknown): TabItem | null {
  if (typeof value !== "object" || value === null) return null;
  const tab = value as Record<string, unknown>;
  const kind = tabKindOf(tab.kind);
  if (
    typeof tab.key !== "string" || tab.key.length === 0 ||
    tab.key.length > TAB_KEY_MAX || kind === undefined
  ) {
    return null;
  }
  return kind.fromStored(tab, {
    key: tab.key,
    position: readPosition(tab.read_position),
  });
}

/** 화면 탭을 schema 필드로 줄인다. 맞출 수 없으면 그 탭만 빠진다. */
function toStoredTab(tab: TabItem): Record<string, unknown> | null {
  return tabKindOf(tab.kind)?.toStored(tab, {
    position: readPosition(tab.readPosition),
  }) ?? null;
}

/** 저장된 layout에서 화면이 쓰는 부분만 꺼낸다. 검증은 main이 이미 했다. */
export function viewFromStored(layout: unknown): WorkspaceView | null {
  if (typeof layout !== "object" || layout === null) return null;
  const value = layout as {
    panes?: { tabs?: unknown[]; selected_tab?: string | null }[];
    split_ratio?: number;
    focused_pane?: number;
  };
  if (!Array.isArray(value.panes)) return null;
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
    panes,
    splitRatio: typeof value.split_ratio === "number" ? value.split_ratio : 0.5,
    focusedPane: focused >= 0 && focused < panes.length ? focused : 0,
    floats: [],
  };
}

/** renderer가 main에 보내는 layout. window bounds와 schema 판은 main이 채운다. */
export function toStoredLayout(input: {
  project: string;
  view: WorkspaceView;
  lastSpace: string;
}): {
  project: string;
  last_space: string;
  panes: { tabs: Record<string, unknown>[]; selected_tab: string | null }[];
  split_ratio: number;
  focused_pane: number;
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
  };
}
