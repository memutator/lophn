// 진짜 Desktop 화면을 mock 데이터로 그린다. 조립은 packages/shell/renderer/desktop/entry.tsx의 mock
// 갈래와 같다. entry는 import하면 바로 mount하므로 이 gallery가 같은 조립을 따로 둔다. 앱 코드는
// 고치지 않고, preload가 없는 일반 browser에 없는 통로(터미널 PTY, overlay)만 여기서 채운다.
import { useMemo } from "react";

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
  openLophn,
  type Route,
} from "../../../packages/shell/renderer/desktop/router.ts";
import type { SettingsPane } from "../../../packages/shell/renderer/desktop/settings/model.ts";
import { createEventClient } from "../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { AppViewsProvider } from "../../../packages/shell/renderer/app-frame/app-views.tsx";
import { ConversationProvider } from "../../../packages/shell/renderer/conversation/window-deps.tsx";
import { DraftStore } from "../../../packages/shell/renderer/conversation/drafts.ts";
import { TerminalStore } from "../../../packages/shell/renderer/terminal/store.ts";
import { createXtermView } from "../../../packages/shell/renderer/terminal/xterm-view.ts";
import { fakeTerminal } from "./fake-terminal.ts";
// 터미널 탭이 쓰는 xterm 기본 배치.
import "@xterm/xterm/css/xterm.css";

export { PROJECT_GROCERY };

/** 작업대 탭 배치. 저장된 layout과 같은 모양이다(workspace/layout-map.ts). */
interface TabSpec {
  readonly key: string;
  readonly kind: "document_editor" | "terminal";
  readonly title: string;
  readonly folder?: string;
}

export interface PaneSpec {
  readonly tabs: readonly TabSpec[];
  readonly selected: string;
}

interface MockDesktopProps {
  readonly route?: Route;
  /** 작업대의 칸 배치. 없으면 시드 배치다. */
  readonly panes?: readonly PaneSpec[];
  /** 이 키의 터미널 탭을 열린 채로 시작한다. */
  readonly openTerminal?: string;
  /** 프로젝트가 하나도 없는 런처로 그린다. */
  readonly emptyLauncher?: boolean;
  /** 이 core 연결 상태를 고정한다(시작 실패 화면). */
  readonly core?: CoreSource;
  /** Settings에서 처음 보일 항목. 주면 route 대신 Settings를 연다. */
  readonly settingsTab?: SettingsTab;
}

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

// gallery의 Settings 탭 이름을 Settings 항목(pane)으로 잇는다.
const SETTINGS_PANE = {
  coding: "coding",
  general: "general",
  diagnostics: "diagnostics",
} as const satisfies Record<string, SettingsPane>;

export type SettingsTab = keyof typeof SETTINGS_PANE;

export function MockDesktop(props: MockDesktopProps) {
  const { panes, openTerminal, core, settingsTab, emptyLauncher } = props;
  const route = settingsTab === undefined
    ? props.route ?? LAUNCHER
    : openLophn("settings", SETTINGS_PANE[settingsTab]);
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
      events: createEventClient(mock.events),
      settingsPanels: mock.settingsPanels,
    };
  }, [panes, openTerminal, emptyLauncher]);
  const { mock } = wiring;
  return (
    <AppViewsProvider value={mock.appViews}>
      <ConversationProvider deps={wiring.conversation}>
        <EventsProvider client={wiring.events}>
          <Desktop
            source={core ?? mock.core}
            initial={route}
            workspace={wiring.workspace}
            editor={mock.editor}
            terminal={wiring.terminal}
            lophn={mock.lophn}
            projects={wiring.projects}
            projectsSource={mock.projectsSource}
            apps={mock.apps}
            settings={mock.settings}
            settingsPanels={wiring.settingsPanels}
            issues={mock.issues}
            appDetail={mock.appDetail}
            views={mock.views}
            annotate={mock.annotate}
            feedback={mock.feedback}
            instructions={mock.instructions}
          />
        </EventsProvider>
      </ConversationProvider>
    </AppViewsProvider>
  );
}
