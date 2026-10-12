// 진짜 Desktop 화면을 mock 데이터로 그린다. 조립은 packages/shell/renderer/desktop/entry.tsx의 mock
// 갈래와 같다. entry는 import하면 바로 mount하므로 이 gallery가 같은 조립을 따로 둔다. 앱 코드는
// 고치지 않고, preload가 없는 일반 browser에 없는 통로(터미널 PTY, overlay)만 여기서 채운다.
import { useEffect, useMemo } from "react";
import { t } from "@lophn/wording";

import { Desktop } from "../../../packages/shell/renderer/desktop/main.tsx";
import {
  type DevMock,
  devMock,
} from "../../../packages/shell/renderer/desktop/dev-mock/mod.ts";
import {
  PROJECT_GROCERY,
} from "../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import type { CoreSource } from "../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  LAUNCHER,
  type Route,
} from "../../../packages/shell/renderer/desktop/router.ts";
import { AppViewsProvider } from "../../../packages/shell/renderer/app-frame/app-views.tsx";
import { ConversationProvider } from "../../../packages/shell/renderer/conversation/window-deps.tsx";
import { DraftStore } from "../../../packages/shell/renderer/conversation/drafts.ts";
import {
  RequestDrafts,
  RequestsProvider,
} from "../../../packages/shell/renderer/desktop/lophn-space/things-to-confirm/context.tsx";
import { TerminalStore } from "../../../packages/shell/renderer/terminal/store.ts";
import { createXtermView } from "../../../packages/shell/renderer/terminal/xterm-view.ts";
import { fakeTerminal } from "./fake-terminal.ts";
// 터미널 탭이 쓰는 xterm 기본 배치.
import "@xterm/xterm/css/xterm.css";

export { PROJECT_GROCERY };

/** 작업대 탭 배치. 저장된 layout과 같은 모양이다(workspace/layout-map.ts). */
export interface TabSpec {
  readonly key: string;
  readonly kind: "document_editor" | "terminal" | "app_panel";
  readonly title: string;
  readonly folder?: string;
  readonly app?: string;
  readonly screen?: string;
}

export interface PaneSpec {
  readonly tabs: readonly TabSpec[];
  readonly selected: string;
}

export interface MockDesktopProps {
  readonly route?: Route;
  /** 작업대의 칸 배치. 없으면 시드 배치다. */
  readonly panes?: readonly PaneSpec[];
  /** 이 키의 터미널 탭을 열린 채로 시작한다. */
  readonly openTerminal?: string;
  /** 프로젝트가 하나도 없는 런처로 그린다. */
  readonly emptyLauncher?: boolean;
  /** 이 core 연결 상태를 고정한다(시작 실패 화면). */
  readonly core?: CoreSource;
  /** Settings에서 열 탭. 탭이 화면 안 상태라서 화면이 뜬 뒤 눌러 고른다. */
  readonly settingsTab?: SettingsTab;
}

const NO_OVERLAY_MENU = { open: () => Promise.resolve("unavailable" as const) };

function layoutOf(panes: readonly PaneSpec[]) {
  return {
    panes: panes.map((pane) => ({
      tabs: pane.tabs,
      selected_tab: pane.selected,
    })),
    split_ratio: 0.5,
    focused_pane: 0,
    information_panel: { open: false, tab: "info" },
  };
}

const SETTINGS_TAB = {
  connections: "settings.label.tab-connections",
  coding: "settings.label.tab-coding",
  extensions: "settings.label.tab-extensions",
  general: "settings.label.tab-general",
  update: "settings.label.tab-update",
  diagnostics: "settings.label.tab-diagnostics",
  notifications: "settings.label.tab-notifications",
} as const;

export type SettingsTab = keyof typeof SETTINGS_TAB;

// settings 탭은 화면 안 상태라서 props로 고를 수 없다. 뜬 뒤 그 탭을 눌러 준다. 아직 안 떴으면
// false를 돌려 다시 해 본다.
function pressSettingsTab(value: SettingsTab): boolean {
  const label = t(SETTINGS_TAB[value]);
  const candidates = [
    ...document.querySelectorAll<HTMLElement>('[role="tab"], button, a'),
  ];
  const tab =
    candidates.find((item) => item.id.endsWith(`-trigger-${value}`)) ??
      candidates.find((item) => item.textContent?.trim() === label);
  if (!tab) return false;
  tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  tab.click();
  return true;
}

export function MockDesktop(props: MockDesktopProps) {
  const { route = LAUNCHER, panes, openTerminal, core } = props;
  const { settingsTab, emptyLauncher } = props;
  useEffect(() => {
    if (settingsTab === undefined) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (pressSettingsTab(settingsTab) || tries > 60) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, [settingsTab]);
  const wiring = useMemo(() => {
    const mock = devMock("?mock") as DevMock;
    const workspace = panes === undefined ? mock.workspace : {
      ...mock.workspace,
      readLayout: () =>
        Promise.resolve({
          ok: true as const,
          available: true as const,
          layout: layoutOf(panes),
        }),
    };
    const terminal = {
      bridge: fakeTerminal(PROJECT_GROCERY),
      store: new TerminalStore(null),
      createView: createXtermView,
      confirmClose: () => Promise.resolve(false),
    };
    if (openTerminal !== undefined) terminal.store.request(openTerminal);
    return {
      mock,
      projects: emptyLauncher === true
        ? {
          ...mock.launcher,
          projects: () => Promise.resolve({ ok: true as const, value: [] }),
        }
        : mock.launcher,
      workspace,
      terminal,
      conversation: { drafts: new DraftStore(), onSettings: () => {} },
      requests: { source: mock.requests, drafts: new RequestDrafts() },
      // 버린 Backup 탭은 gallery에 없다.
      settingsPanels: { ...mock.settingsPanels, backup: undefined },
    };
  }, [panes, openTerminal, emptyLauncher]);
  const { mock } = wiring;
  return (
    <AppViewsProvider value={mock.appViews}>
      <ConversationProvider deps={wiring.conversation}>
        <RequestsProvider deps={wiring.requests}>
          <Desktop
            source={core ?? mock.core}
            initial={route}
            workspace={wiring.workspace}
            editor={{ ...mock.editor, menu: NO_OVERLAY_MENU }}
            terminal={wiring.terminal}
            lophn={mock.lophn}
            organize={mock.organize}
            projects={wiring.projects}
            apps={mock.apps}
            settings={mock.settings}
            settingsPanels={wiring.settingsPanels}
            coding={mock.coding}
            tasks={mock.tasks}
            issues={mock.issues}
            appDetail={mock.appDetail}
            views={mock.views}
            appWindows={mock.appWindows}
            feedback={mock.feedback}
            instructions={mock.instructions}
          />
        </RequestsProvider>
      </ConversationProvider>
    </AppViewsProvider>
  );
}
