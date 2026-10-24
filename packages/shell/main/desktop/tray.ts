// tray. 런처·로그인 자동 시작·Quit을 둔다. 모든 창을 닫아도
// main과 tray, 그 아래 core는 남는다. tray의 Quit만 main과 core를 멈추는 명시 행동이다.
// Electron Tray·Menu는 adapter 뒤에 둔다.
import { join } from "node:path";

import type { AutostartState } from "./autostart.ts";
import { word } from "./wording.ts";

type TrayItemId = "launcher" | "autostart" | "quit";

/** 안내만 하는 OS 기능 실패. 그 기능 하나만 말하고 누를 수 없다. */
type TrayNotice = "global-search-unavailable";

type TrayMenuItem =
  | { type: "normal"; id: TrayItemId; label: string }
  | { type: "notice"; label: string }
  | {
    type: "checkbox";
    id: TrayItemId;
    label: string;
    checked: boolean;
    enabled: boolean;
  }
  | { type: "separator" };

const NOTICE_LABELS = {
  "global-search-unavailable": "common.label.tray-global-search-unavailable",
} as const;

/**
 * tray menu. 자동 시작을 쓸 수 없는 실행(개발 실행 등)에서는 그 항목을 끈다. 쓸 수 없게 된
 * OS 기능은 Quit 위에 누를 수 없는 줄로 하나씩 보인다.
 */
function trayMenu(
  autostart: AutostartState,
  notices: readonly TrayNotice[] = [],
): TrayMenuItem[] {
  const shown: TrayMenuItem[] = notices.map((notice) => ({
    type: "notice",
    label: word(NOTICE_LABELS[notice]),
  }));
  return [
    {
      type: "normal",
      id: "launcher",
      label: word("common.label.tray-launcher"),
    },
    { type: "separator" },
    {
      type: "checkbox",
      id: "autostart",
      label: word("common.label.tray-start-at-login"),
      checked: autostart.enabled,
      enabled: autostart.available,
    },
    { type: "separator" },
    ...(shown.length > 0
      ? [...shown, { type: "separator" } satisfies TrayMenuItem]
      : []),
    { type: "normal", id: "quit", label: word("common.label.tray-quit") },
  ];
}

interface TrayHandle {
  setToolTip(text: string): void;
  setMenu(items: TrayMenuItem[], onSelect: (id: TrayItemId) => void): void;
  /** 아이콘 클릭(Linux appindicator는 보내지 않을 수 있다). */
  onClick(handler: () => void): void;
  destroy(): void;
}

export interface TrayFactory {
  /** 실패하면 throw한다(아이콘 없음, 표시 영역 없음 등). */
  create(icon: string): TrayHandle;
}

interface TrayActions {
  /** 가장 최근 창을 앞으로, 창이 없으면 새 기본 창. */
  openWindow(): void;
  /** 새 기본 창. 새 기본 창은 언제나 런처에서 시작한다. */
  openLauncher(): void;
  readAutostart(): AutostartState;
  writeAutostart(enabled: boolean): AutostartState;
  /** 명시 종료. 진행 중인 일 확인은 quit flow가 한다. */
  quit(): void;
}

interface TrayOptions {
  factory: TrayFactory;
  icon: string;
  actions: TrayActions;
  log?: (message: string) => void;
}

export interface InstalledTray {
  /** 자동 시작 상태가 바뀌면 menu를 다시 그린다. */
  refresh(): void;
  /** 쓸 수 없게 된 OS 기능을 menu에 한 번 보인다. */
  notice(notice: TrayNotice): void;
  destroy(): void;
}

/**
 * tray를 띄운다. 실패하면 log만 남기고 undefined다. tray가 없어도 창 닫기는 종료가 아니다.
 * 다시 실행하면 second-instance가 창을 연다.
 */
export function installTray(options: TrayOptions): InstalledTray | undefined {
  const { actions } = options;
  let handle: TrayHandle;
  try {
    handle = options.factory.create(options.icon);
  } catch (error) {
    (options.log ?? defaultLog)(
      `tray를 띄우지 못했다: ${(error as Error).message}`,
    );
    return undefined;
  }
  let autostart = actions.readAutostart();
  const notices: TrayNotice[] = [];
  const render = () => handle.setMenu(trayMenu(autostart, notices), select);
  function select(id: TrayItemId): void {
    switch (id) {
      case "launcher":
        actions.openLauncher();
        return;
      case "autostart":
        // 결과는 OS에서 다시 읽은 상태다. 실패하면 꺼진 채로 보인다.
        autostart = actions.writeAutostart(!autostart.enabled);
        render();
        return;
      case "quit":
        actions.quit();
        return;
    }
  }
  handle.setToolTip(word("common.label.tray-tooltip"));
  handle.onClick(() => actions.openWindow());
  render();
  return {
    refresh() {
      autostart = actions.readAutostart();
      render();
    },
    notice(notice) {
      if (notices.includes(notice)) return;
      notices.push(notice);
      render();
    },
    destroy() {
      handle.destroy();
    },
  };
}

interface IconLocation {
  packaged: boolean;
  /** packaged build의 `process.resourcesPath`. */
  resourcesPath: string;
  /** 개발 실행의 `packages/shell/main/desktop`. */
  desktopDir: string;
}

/** lophn 표식. tray와 창(작업 표시줄) 아이콘이 같이 쓴다. packaged는 resources 옆, 개발 실행은 desktop 폴더. */
export function appIconPath(location: IconLocation): string {
  return location.packaged
    ? join(location.resourcesPath, "icon.png")
    : join(location.desktopDir, "icon.png");
}

/** panel의 tray 아이콘은 16px이다. */
export const TRAY_ICON_SIZE = 16;

function defaultLog(message: string): void {
  console.log(`[lophn] ${message}`);
}
