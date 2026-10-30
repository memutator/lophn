// 화면 자리(WorkspaceDesks)와 layout 파일(`active_desk`, `desks`)을 오간다. 파일에 남는 것은 schema 필드뿐이다.
import {
  DEFAULT_DESK,
  type DetachedItem,
  type FloatItem,
  normalizePane,
  type PaneState,
  storableDesks,
  type TabItem,
  type WorkspaceDesks,
  type WorkspaceView,
} from "./model.ts";
import { tabKindOf } from "./kinds/registry.ts";
import {
  evenRow,
  type LayoutNode,
  leafCount,
  MAX_PANES,
} from "./layout-tree.ts";

// 탭 key는 kind마다 다르다. 파일 탭은 절대 경로이고 나머지는 짧은 이름이다.
const TAB_KEY_MAX = 4096;

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

/** layout 파일 탭을 화면에 그린다. 맞출 수 없거나 등록되지 않은 kind면 null이다. */
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

/** 화면 탭을 schema 필드로 줄인다. 맞출 수 없으면 그 탭만 빠진다. */
function toStoredTab(tab: TabItem): Record<string, unknown> | null {
  return (
    tabKindOf(tab.kind)?.toStored(tab, {
      position: readPosition(tab.readPosition),
    }) ?? null
  );
}

/** 저장된 떠 있는 탭. 탭이나 rect를 맞출 수 없으면 null이다. */
function floatFromStored(value: unknown): FloatItem | null {
  if (typeof value !== "object" || value === null) return null;
  const float = value as Record<string, unknown>;
  const tab = tabFromStored(float.tab);
  const rect = float.rect as Record<string, unknown> | null | undefined;
  if (
    tab === null ||
    typeof rect !== "object" ||
    rect === null ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)
  ) {
    return null;
  }
  return {
    tab,
    rect: {
      x: rect.x as number,
      y: rect.y as number,
      width: rect.width as number,
      height: rect.height as number,
    },
    minimized: float.minimized === true,
    originPane:
      typeof float.origin_pane === "number" &&
      Number.isInteger(float.origin_pane) &&
      float.origin_pane >= 0 &&
      float.origin_pane < MAX_PANES
        ? float.origin_pane
        : 0,
    ...(typeof float.docked_at === "number" && float.minimized === true
      ? { dockedAt: float.docked_at }
      : {}),
  };
}

/** 저장된 detached 탭. 탭이나 bounds를 맞출 수 없으면 null이다. */
function detachedFromStored(value: unknown): DetachedItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const tab = tabFromStored(item.tab);
  const bounds = item.bounds as Record<string, unknown> | null | undefined;
  if (
    tab === null ||
    typeof bounds !== "object" ||
    bounds === null ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger)
  ) {
    return null;
  }
  return {
    tab,
    bounds: {
      x: bounds.x as number,
      y: bounds.y as number,
      width: bounds.width as number,
      height: bounds.height as number,
    },
  };
}

function parseNode(value: unknown): LayoutNode | null {
  if (value === "leaf") return "leaf";
  if (
    typeof value !== "object" ||
    value === null ||
    !("dir" in value) ||
    !("ratio" in value) ||
    !("a" in value) ||
    !("b" in value)
  ) {
    return null;
  }
  const { dir, ratio } = value;
  const a = parseNode(value.a);
  const b = parseNode(value.b);
  if (
    (dir !== "row" && dir !== "column") ||
    typeof ratio !== "number" ||
    !(ratio > 0 && ratio < 1) ||
    a === null ||
    b === null
  ) {
    return null;
  }
  return { dir, ratio, a, b };
}

/** 저장된 칸 배치 tree. 잎 수가 칸 수와 다르거나 모양이 틀리면 같은 폭으로 늘어놓는다. */
function nodeFromStored(value: unknown, leaves: number): LayoutNode {
  const node = parseNode(value);
  return node !== null && leafCount(node) === leaves ? node : evenRow(leaves);
}

/** 저장된 자리 하나를 view로 바꾼다. 검증은 main이 이미 했다. */
function viewOfDesk(desk: unknown): WorkspaceView | null {
  if (typeof desk !== "object" || desk === null) return null;
  const value = desk as {
    panes?: { tabs?: unknown[]; selected_tab?: string | null }[];
    layout?: unknown;
    focused_pane?: number;
    floats?: unknown;
    detached?: unknown;
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
    }),
  );
  const focused =
    typeof value.focused_pane === "number" ? value.focused_pane : 0;
  return {
    panes,
    layout: nodeFromStored(value.layout, panes.length),
    focusedPane: focused >= 0 && focused < panes.length ? focused : 0,
    floats: Array.isArray(value.floats)
      ? value.floats.flatMap((float) => {
          const item = floatFromStored(float);
          return item === null ? [] : [item];
        })
      : [],
    detached: Array.isArray(value.detached)
      ? value.detached.flatMap((entry) => {
          const item = detachedFromStored(entry);
          return item === null ? [] : [item];
        })
      : [],
  };
}

/** 저장된 layout의 모든 자리를 꺼낸다. 맞출 수 없는 자리는 빠지고, `DEFAULT_DESK`가 없으면 null이다. */
export function desksFromStored(layout: unknown): WorkspaceDesks | null {
  if (typeof layout !== "object" || layout === null) return null;
  const value = layout as { active_desk?: unknown; desks?: unknown };
  if (typeof value.desks !== "object" || value.desks === null) return null;
  const desks: Record<string, WorkspaceView> = {};
  for (const [key, desk] of Object.entries(value.desks)) {
    const view = viewOfDesk(desk);
    if (view !== null) desks[key] = view;
  }
  if (!Object.hasOwn(desks, DEFAULT_DESK)) return null;
  const active =
    typeof value.active_desk === "string" &&
    Object.hasOwn(desks, value.active_desk)
      ? value.active_desk
      : DEFAULT_DESK;
  return { active, desks };
}

interface StoredDesk {
  panes: { tabs: Record<string, unknown>[]; selected_tab: string | null }[];
  layout: LayoutNode;
  focused_pane: number;
  floats: {
    tab: Record<string, unknown>;
    rect: FloatItem["rect"];
    minimized: boolean;
    origin_pane: number;
    docked_at?: number;
  }[];
  detached: {
    tab: Record<string, unknown>;
    bounds: DetachedItem["bounds"];
  }[];
}

/** view 하나를 schema 상한 안의 자리로 줄인다. transient 탭은 이미 빠진 view를 받는다. */
function storedDesk(view: WorkspaceView): StoredDesk {
  const panes = view.panes.slice(0, MAX_PANES).map((pane) => {
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
  // 잎 수가 칸 수와 다르면(칸을 줄여 저장한 경우) 같은 폭으로 늘어놓는다.
  const layout =
    leafCount(view.layout) === kept.length ? view.layout : evenRow(kept.length);
  const focused =
    view.focusedPane >= 0 && view.focusedPane < kept.length
      ? view.focusedPane
      : 0;
  const floats = view.floats
    .flatMap((float) => {
      const tab = toStoredTab(float.tab);
      return tab === null
        ? []
        : [
            {
              tab,
              rect: float.rect,
              minimized: float.minimized,
              origin_pane: Math.min(float.originPane, MAX_PANES - 1),
              ...(float.dockedAt === undefined
                ? {}
                : { docked_at: float.dockedAt }),
            },
          ];
    })
    .slice(0, 20);
  const detached = view.detached
    .flatMap((item) => {
      const tab = toStoredTab(item.tab);
      return tab === null ? [] : [{ tab, bounds: item.bounds }];
    })
    .slice(0, 20);
  return {
    panes: kept,
    layout,
    focused_pane: focused,
    floats,
    detached,
  };
}

/** renderer가 main에 보내는 layout. window bounds와 schema 판은 main이 채운다. */
export function toStoredLayout(input: {
  project: string;
  desks: WorkspaceDesks;
}): {
  project: string;
  active_desk: string;
  desks: Record<string, StoredDesk>;
} {
  const desks = storableDesks(input.desks);
  return {
    project: input.project,
    active_desk: desks.active,
    desks: Object.fromEntries(
      Object.entries(desks.desks).map(([key, view]) => [key, storedDesk(view)]),
    ),
  };
}
