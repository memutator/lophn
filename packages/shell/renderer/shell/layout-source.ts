// renderer가 workspace layout을 읽고 쓰는 통로. main의 `shell:workspace-layout-*` IPC(preload의 lophnLayout)를 감싸고
// 저장된 snake_case 값과 WorkspaceLayout을 오간다. tab 값은 kinds registry의 fromStored/toStored가 정한다.
// tab 읽기·쓰기 보조는 옛 workspace/layout-map.ts와 같은 규칙이다(그 파일은 옛 layout을 지울 때 같이 없어진다).
import type {
  WorkspaceLayoutReadResult,
  WorkspaceLayoutSaveResult,
} from "../../ipc/workspace.ts";
import { tabKindOf } from "../workspace/kinds/registry.ts";
import {
  type Desk,
  type DetachedItem,
  type FloatRect,
  type FloatTab,
  clampSplitRatio,
  GROUP_MAX,
  type Group,
  type GroupNode,
  MAIN_DESK,
  type WorkspaceLayout,
  type WorkspaceQuick,
  type WorkspaceRef,
  workspaceKey,
  settle,
  type TabItem,
} from "./desk-model.ts";

// main/workspace/workspace-layout.ts의 상한과 같다.
const FLOATS_MAX = 20;
const DETACHED_MAX = 20;
const TAB_KEY_MAX = 4096;

export interface WorkspaceLayoutBridge {
  readWorkspace(input: {
    workspace: string;
  }): Promise<WorkspaceLayoutReadResult>;
  saveWorkspace(input: {
    workspace: string;
    layout: unknown;
  }): Promise<WorkspaceLayoutSaveResult>;
}

/** layout이 null이면 쓸 만한 저장 값이 없다(없음, 손상, 다른 판). 부르는 쪽이 기본 layout을 쓴다. */
export type WorkspaceLayoutRead =
  | { ok: true; layout: WorkspaceLayout | null }
  | { ok: false; message: string };

export interface LayoutSource {
  readWorkspaceLayout(workspace: WorkspaceRef): Promise<WorkspaceLayoutRead>;
  saveWorkspaceLayout(
    workspace: WorkspaceRef,
    layout: WorkspaceLayout,
  ): Promise<{ ok: boolean }>;
}

const globalBridge = (): WorkspaceLayoutBridge | undefined =>
  (globalThis as { lophnLayout?: WorkspaceLayoutBridge }).lophnLayout;

export function createLayoutSource(
  bridge: () => WorkspaceLayoutBridge | undefined = globalBridge,
): LayoutSource {
  return {
    async readWorkspaceLayout(workspace) {
      const api = bridge();
      if (api === undefined) {
        return { ok: false, message: "layout is unavailable" };
      }
      try {
        const reply = await api.readWorkspace({
          workspace: workspaceKey(workspace),
        });
        if (!reply.ok) return { ok: false, message: reply.code };
        return {
          ok: true,
          layout: reply.available ? layoutFromStored(reply.layout) : null,
        };
      } catch {
        return { ok: false, message: "layout is unavailable" };
      }
    },
    async saveWorkspaceLayout(workspace, layout) {
      const api = bridge();
      if (api === undefined) return { ok: false };
      try {
        const reply = await api.saveWorkspace({
          workspace: workspaceKey(workspace),
          layout: layoutToStored(layout),
        });
        return { ok: reply.ok };
      } catch {
        return { ok: false };
      }
    },
  };
}

/** 메모리에 두는 가짜 통로. dev mock과 gallery가 쓴다. 저장한 값을 JSON으로 거쳐 그대로 돌려준다. initial은 저장하기 전 project·앱 workspace가 읽는 처음 layout이다(Home은 빈 채로 시작한다). */
export function fakeWorkspaceLayoutBridge(
  initial?: WorkspaceLayout,
): WorkspaceLayoutBridge {
  const saved = new Map<string, string>();
  const first =
    initial === undefined ? undefined : JSON.stringify(layoutToStored(initial));
  return {
    readWorkspace: ({ workspace }) => {
      const json =
        saved.get(workspace) ?? (workspace === "home" ? undefined : first);
      return Promise.resolve(
        json === undefined
          ? { ok: true, available: false, reason: "absent" }
          : { ok: true, available: true, layout: JSON.parse(json) },
      );
    },
    saveWorkspace: ({ workspace, layout }) => {
      saved.set(workspace, JSON.stringify(layout));
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

// tab이 빠졌을 때(알 수 없는 kind, 저장할 수 없는 tab) 고른 tab과 group이 남은 tabs 안에 있게 고친다. group은
// tab이 빠지면 칸에서 걷어내고(보이던 tab이면 stack의 이웃이 보인다) 1개로 줄면 풀며, 구성원을 다시 붙인다.
function repaired(desk: Desk): Desk {
  const keys = new Set(desk.tabs.map((tab) => tab.key));
  return settle({
    ...desk,
    selected:
      desk.selected !== null && keys.has(desk.selected)
        ? desk.selected
        : (desk.tabs[0]?.key ?? null),
  });
}

function compact<T>(items: readonly (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

type Stored = Record<string, unknown>;

// main이 이미 검증했다. 모양이 틀리면 그 group만 버리고 tab은 남는다.
function nodeFromStored(value: unknown, depth = 0): GroupNode | null {
  const node = value as Stored | null;
  if (typeof node !== "object" || node === null || depth > GROUP_MAX) {
    return null;
  }
  if (typeof node.tab === "string") {
    const stack = Array.isArray(node.stack)
      ? node.stack.filter((key): key is string => typeof key === "string")
      : [];
    return stack.length >= 2 && stack.includes(node.tab)
      ? { tab: node.tab, stack }
      : { tab: node.tab };
  }
  const a = nodeFromStored(node.a, depth + 1);
  const b = nodeFromStored(node.b, depth + 1);
  if (a === null || b === null) return null;
  return {
    dir: node.dir === "column" ? "column" : "row",
    ratio: clampSplitRatio(typeof node.ratio === "number" ? node.ratio : 0.5),
    a,
    b,
  };
}

function nodeToStored(node: GroupNode): Stored {
  return "tab" in node
    ? node.stack === undefined
      ? { tab: node.tab }
      : { tab: node.tab, stack: [...node.stack] }
    : {
        dir: node.dir,
        ratio: node.ratio,
        a: nodeToStored(node.a),
        b: nodeToStored(node.b),
      };
}

function groupFromStored(value: unknown): Group | null {
  const group = value as Stored | null;
  const layout = nodeFromStored(group?.layout);
  if (layout === null || typeof group?.focus !== "string") return null;
  return { layout, focus: group.focus };
}

function deskFromStored(key: string, value: unknown): Desk | null {
  if (typeof value !== "object" || value === null) return null;
  const desk = value as Stored;
  const list = (field: string): unknown[] =>
    Array.isArray(desk[field]) ? (desk[field] as unknown[]) : [];
  return repaired({
    key,
    label: typeof desk.label === "string" ? desk.label : key,
    ...(typeof desk.workflow === "string" ? { workflow: desk.workflow } : {}),
    tabs: compact(list("tabs").map(tabFromStored)),
    selected: typeof desk.selected_tab === "string" ? desk.selected_tab : null,
    groups: compact(list("groups").map(groupFromStored)),
    floats: compact(
      list("floats").map((item): FloatTab | null => {
        const float = item as Stored | null;
        const tab = tabFromStored(float?.tab);
        const rect = rectOf(float?.rect);
        return tab === null || rect === null
          ? null
          : {
              tab,
              rect,
              minimized: float?.minimized === true,
              pinned: float?.pinned === true,
            };
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

// main이 이미 검증했다. 모양이 틀리면 없는 것으로 본다.
function quickFromStored(value: unknown): WorkspaceQuick | undefined {
  const quick = value as {
    order?: unknown;
    apps?: unknown;
    hidden?: unknown;
  } | null;
  if (!Array.isArray(quick?.order) || !Array.isArray(quick.apps)) {
    return undefined;
  }
  return {
    order: quick.order.filter((id): id is string => typeof id === "string"),
    apps: quick.apps.flatMap((item: Stored | null) =>
      typeof item?.app === "string" && typeof item.surface === "string"
        ? [{ app: item.app, surface: item.surface }]
        : [],
    ),
    ...(Array.isArray(quick.hidden)
      ? {
          hidden: quick.hidden.filter(
            (id): id is string => typeof id === "string",
          ),
        }
      : {}),
  };
}

/** 저장된 layout을 읽는다. main이 이미 검증했다. 모양이 틀리거나 Main이 없으면 null이다. */
export function layoutFromStored(value: unknown): WorkspaceLayout | null {
  const stored = value as {
    active_desk?: unknown;
    desks?: unknown;
    quick?: unknown;
  } | null;
  if (typeof stored?.desks !== "object" || stored.desks === null) return null;
  const desks: Record<string, Desk> = {};
  for (const [key, desk] of Object.entries(stored.desks)) {
    const read = deskFromStored(key, desk);
    if (read !== null) desks[key] = read;
  }
  if (!Object.hasOwn(desks, MAIN_DESK)) return null;
  const quick = quickFromStored(stored.quick);
  return {
    active:
      typeof stored.active_desk === "string" &&
      Object.hasOwn(desks, stored.active_desk)
        ? stored.active_desk
        : MAIN_DESK,
    desks,
    ...(quick === undefined ? {} : { quick }),
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
    groups: desk.groups.map((group) => ({
      layout: nodeToStored(group.layout),
      focus: group.focus,
    })),
    floats: compact(
      desk.floats.map((item) => {
        const tab = tabToStored(item.tab);
        return tab === null
          ? null
          : {
              tab,
              rect: item.rect,
              minimized: item.minimized,
              ...(item.pinned ? { pinned: true } : {}),
            };
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
export function layoutToStored(layout: WorkspaceLayout): {
  active_desk: string;
  desks: Record<string, Stored>;
  quick?: WorkspaceQuick;
} {
  return {
    ...(layout.quick === undefined ? {} : { quick: layout.quick }),
    active_desk: layout.active,
    desks: Object.fromEntries(
      Object.entries(layout.desks).map(([key, desk]) => [
        key,
        deskToStored(desk),
      ]),
    ),
  };
}
