// 빠른 실행의 전역 값 여섯: 단추 순서·고정 앱 panel(`shell.quick_launch`), 앱 panel 화면마다 여는 자리와
// 마지막 float 자리(`shell.app_launch`), 작업 표시줄(`shell.taskbar`),
// 오른쪽 sidebar panel에서 끈 앱 화면(`shell.sidebar_panels_off`), tray에서 끈 앱 화면(`shell.tray_off`), tray 항목 순서(`shell.tray_order`).
// 앱 화면은 선언하면 나오고 끈 것만 여기에 쌓인다.
// 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
import type { FloatRect, WorkspaceQuick } from "../../../shell/desk-model.ts";
import type { SourceResult } from "../source.ts";

/** 앱 panel 화면 하나를 새로 열 때의 자리. rect는 마지막으로 옮기거나 크기를 바꾼 float 자리다. */
export interface AppLaunch {
  readonly open: "dock" | "float";
  readonly rect?: FloatRect;
}

export type AppLaunchMap = Readonly<Record<string, AppLaunch>>;

export interface QuickPrefs {
  readonly quick: WorkspaceQuick;
  readonly launch: AppLaunchMap;
  /** workspace 창 맨 아래 작업 표시줄(`shell.taskbar`). */
  readonly taskbar: boolean;
  /** 사람이 끈 오른쪽 sidebar 앱 panel(`shell.sidebar_panels_off`). */
  readonly sidebarPanelsOff: readonly SidebarPanelPick[];
  /** 사람이 끈 작업 표시줄(꺼져 있으면 title bar) tray 항목(`shell.tray_off`). */
  readonly trayOff: readonly SidebarPanelPick[];
  /** 사람이 정한 tray 항목 순서(`shell.tray_order`). 없는 화면은 뒤에 선언 순서로 선다. */
  readonly trayOrder: readonly SidebarPanelPick[];
}

export interface SidebarPanelPick {
  readonly app: string;
  readonly screen: string;
}

export interface QuickPrefsSource {
  read(): Promise<SourceResult<QuickPrefs>>;
  write<K extends keyof QuickPrefs>(
    key: K,
    value: QuickPrefs[K],
  ): Promise<SourceResult<null>>;
}

export const DEFAULT_QUICK_PREFS: QuickPrefs = {
  quick: { order: [], apps: [] },
  launch: {},
  taskbar: true,
  sidebarPanelsOff: [],
  trayOff: [],
  trayOrder: [],
};

export const launchKey = (app: string, surface: string): string =>
  `${app}:${surface}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// core가 이미 모양을 검사했다. 여기서는 틀린 항목만 버린다.
export function quickFromValue(value: unknown): WorkspaceQuick {
  if (!isRecord(value)) return DEFAULT_QUICK_PREFS.quick;
  const order = Array.isArray(value.order)
    ? value.order.filter((id): id is string => typeof id === "string")
    : [];
  const apps = Array.isArray(value.apps)
    ? value.apps.flatMap((item: unknown) =>
        isRecord(item) &&
        typeof item.app === "string" &&
        typeof item.surface === "string"
          ? [{ app: item.app, surface: item.surface }]
          : [],
      )
    : [];
  const hidden = Array.isArray(value.hidden)
    ? value.hidden.filter((id): id is string => typeof id === "string")
    : [];
  return { order, apps, hidden };
}

function rectFromValue(value: unknown): FloatRect | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, width, height } = value;
  return typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number"
    ? { x, y, width, height }
    : undefined;
}

export function launchFromValue(value: unknown): AppLaunchMap {
  if (!isRecord(value)) return {};
  const out: Record<string, AppLaunch> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isRecord(item) || (item.open !== "dock" && item.open !== "float")) {
      continue;
    }
    const rect = rectFromValue(item.rect);
    out[key] = { open: item.open, ...(rect === undefined ? {} : { rect }) };
  }
  return out;
}

// `shell.sidebar_panels_off`, `shell.tray_off`, `shell.tray_order`가 같은 모양이다.
export function picksFromValue(value: unknown): SidebarPanelPick[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) =>
    isRecord(item) &&
    typeof item.app === "string" &&
    typeof item.screen === "string"
      ? [{ app: item.app, screen: item.screen }]
      : [],
  );
}

/** `order`에 든 것을 그 순서로 앞에 두고, 나머지는 받은 순서대로 뒤에 둔다. */
export function byTrayOrder<T extends SidebarPanelPick>(
  items: readonly T[],
  order: readonly SidebarPanelPick[],
): T[] {
  const rank = (item: T) => {
    const at = order.findIndex(
      (pick) => pick.app === item.app && pick.screen === item.screen,
    );
    return at < 0 ? order.length : at;
  };
  return items
    .map((item, at) => ({ item, at, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map(({ item }) => item);
}
