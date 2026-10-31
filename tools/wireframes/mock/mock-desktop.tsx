// 진짜 Desktop 화면을 mock 데이터로 그린다. 조립은 packages/shell/renderer/desktop/entry.tsx의 mock
// 갈래와 같다. entry는 import하면 바로 mount하므로 이 gallery가 같은 조립을 따로 둔다. 앱 코드는
// 고치지 않고, preload가 없는 일반 browser에 없는 통로(터미널 PTY, overlay)만 여기서 채운다.
import { useMemo } from "react";

import { Desktop } from "../../../packages/shell/renderer/desktop/main.tsx";
import {
  type DevMock,
  devMock,
} from "../../../packages/shell/renderer/desktop/dev-mock/mod.ts";
import { PROJECT_GROCERY } from "../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import type { CoreSource } from "../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  LAUNCHER,
  openDetached,
  openSettings,
  type Route,
} from "../../../packages/shell/renderer/desktop/router.ts";
import { DEFAULT_DESK } from "../../../packages/shell/renderer/workspace/model.ts";
import type { SettingsPane } from "../../../packages/shell/renderer/desktop/settings/model.ts";
import { createEventClient } from "../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { AppViewsProvider } from "../../../packages/shell/renderer/app-frame/app-views.tsx";
import { BrowserApiProvider } from "../../../packages/shell/renderer/browser/browser-api.tsx";
import {
  AnnotateApiProvider,
  ArtifactApiProvider,
} from "../../../packages/shell/renderer/artifact/artifact-api.tsx";
import type { LophnArtifactApi } from "../../../packages/shell/ipc/artifact.ts";
import type { LophnShellAnnotateApi } from "../../../packages/shell/ipc/annotation.ts";
import type { LophnBrowserApi } from "../../../packages/shell/ipc/browser.ts";
import type {
  DetachedTaken,
  LophnDetachedApi,
} from "../../../packages/shell/ipc/detached.ts";
import { ConversationProvider } from "../../../packages/shell/renderer/conversation/window-deps.tsx";
import { DraftStore } from "../../../packages/shell/renderer/conversation/drafts.ts";
import { TerminalStore } from "../../../packages/shell/renderer/terminal/store.ts";
import { TerminalDisplays } from "../../../packages/shell/renderer/terminal/displays.ts";
import { createXtermView } from "../../../packages/shell/renderer/terminal/xterm-view.ts";
import { fakeTerminal } from "./fake-terminal.ts";
// 터미널 탭이 쓰는 xterm 기본 배치.
import "@xterm/xterm/css/xterm.css";

export { PROJECT_GROCERY };

/** 작업대 탭 배치. 저장된 layout과 같은 모양이다(workspace/layout-map.ts). */
interface TabSpec {
  readonly key: string;
  readonly kind:
    | "document_editor"
    | "terminal"
    | "app_panel"
    | "project_settings"
    | "browser"
    | "artifact";
  readonly title: string;
  readonly folder?: string;
  /** app_panel 탭이 여는 앱과 그 화면 key. */
  readonly app?: string;
  readonly screen?: string;
  /** browser 탭이 처음 여는 주소. 빈 글이면 빈 주소 칸이다. */
  readonly url?: string;
  /** artifact 탭이 여는 대상. (domain, name)은 domain의 artifact, path는 사람의 폴더에 있는 .html이다. */
  readonly domain?: string;
  readonly name?: string;
  readonly path?: string;
}

export interface PaneSpec {
  readonly tabs: readonly TabSpec[];
  readonly selected: string;
}

/** 떠 있는 탭. 저장된 layout의 floats 항목과 같은 모양이다. */
export interface FloatSpec {
  readonly tab: TabSpec;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly minimized?: boolean;
  readonly originPane?: number;
}

interface MockDesktopProps {
  readonly route?: Route;
  /** 작업대의 칸 배치. 없으면 시드 배치다. */
  readonly panes?: readonly PaneSpec[];
  /** 칸 위에 뜬 탭. 없으면 없다. */
  readonly floats?: readonly FloatSpec[];
  /** 이 키의 터미널 탭을 열린 채로 시작한다. */
  readonly openTerminal?: string;
  /** 프로젝트가 하나도 없는 런처로 그린다. */
  readonly emptyLauncher?: boolean;
  /** 이 core 연결 상태를 고정한다(시작 실패 화면). */
  readonly core?: CoreSource;
  /** Settings에서 처음 보일 항목. 주면 route 대신 Settings를 연다. */
  readonly settingsTab?: SettingsTab;
  /** browser 탭 통로. page가 fake(`fakeBrowserApi`)로 bookmark와 사건을 정할 때 준다. 없으면 dev mock 것이다. */
  readonly browser?: LophnBrowserApi;
  /** artifact 탭 통로. page가 fake(`fakeArtifactApi`)로 정한다. 없으면 통로 없는 창이다. */
  readonly artifact?: LophnArtifactApi;
  /** annotate 통로. page가 fake(`fakeAnnotate`)로 처음 목록을 정한다. 없으면 dev mock 것이다. */
  readonly annotate?: LophnShellAnnotateApi;
  /** 주면 이 탭 하나를 그리는 detached 창으로 시작한다(route는 무시한다). */
  readonly detachedTab?: TabSpec;
  /** activity bar에 고정한 앱 패널. 저장된 layout의 rail_apps와 같은 모양이다. */
  readonly railApps?: readonly {
    readonly app: string;
    readonly surface: string;
    readonly title?: string;
    readonly open?: "dock" | "float";
  }[];
}

// detached 통로의 가짜. preload가 없는 browser에는 없어서, 탭 menu의 Detach와 [Detach] 단추를 그리고 detached 창이 탭을 받게 한다.
function fakeDetached(taken?: DetachedTaken): LophnDetachedApi {
  return {
    open: () =>
      Promise.resolve({ bounds: { x: 0, y: 0, width: 960, height: 600 } }),
    focus: () => Promise.resolve(),
    close: () => Promise.resolve(),
    showOnly: (input) => Promise.resolve({ missing: input.keys }),
    take: () =>
      taken === undefined
        ? Promise.reject(new Error("not_found"))
        : Promise.resolve(taken),
    dock: () => Promise.resolve(),
    changed: () => Promise.resolve(),
    openTab: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    subscribe: () => () => {},
  };
}

// 저장된 layout의 탭 모양으로 바꾼다. 문서 탭은 key가 곧 path이고, 터미널 탭은 연 폴더를 갖는다.
function storedTab(tab: TabSpec) {
  if (tab.kind === "browser") {
    return { kind: tab.kind, key: tab.key, url: tab.url ?? "" };
  }
  if (tab.kind === "artifact") {
    return tab.name !== undefined
      ? {
          kind: tab.kind,
          key: tab.key,
          domain: tab.domain,
          name: tab.name,
        }
      : {
          kind: tab.kind,
          key: tab.key,
          project: PROJECT_GROCERY,
          path: tab.path,
        };
  }
  if (tab.kind === "app_panel") {
    return {
      kind: tab.kind,
      key: tab.key,
      app: tab.app,
      surface: tab.screen,
    };
  }
  if (tab.kind === "project_settings") return { kind: tab.kind, key: tab.key };
  return tab.kind === "terminal"
    ? {
        kind: tab.kind,
        key: tab.key,
        project_folder: tab.folder ?? "/home/mina/Documents/grocery",
        title: tab.title,
      }
    : { kind: tab.kind, key: tab.key, path: tab.key };
}

function layoutOf(
  panes: readonly PaneSpec[],
  floats: readonly FloatSpec[],
  railApps: NonNullable<MockDesktopProps["railApps"]>,
) {
  return {
    active_desk: DEFAULT_DESK,
    rail_apps: railApps,
    desks: {
      [DEFAULT_DESK]: {
        panes: panes.map((pane) => ({
          tabs: pane.tabs.map(storedTab),
          selected_tab: pane.selected,
        })),
        layout:
          panes.length === 2
            ? { dir: "row", ratio: 0.5, a: "leaf", b: "leaf" }
            : "leaf",
        focused_pane: 0,
        floats: floats.map((float) => ({
          tab: storedTab(float.tab),
          rect: float.rect,
          minimized: float.minimized ?? false,
          origin_pane: float.originPane ?? 0,
        })),
        detached: [],
      },
    },
  };
}

// gallery의 Settings 탭 이름을 Settings 항목(pane)으로 잇는다.
const SETTINGS_PANE = {
  coding: "coding",
  general: "general",
  diagnostics: "diagnostics",
  browser: "browser",
} as const satisfies Record<string, SettingsPane>;

export type SettingsTab = keyof typeof SETTINGS_PANE;

export function MockDesktop(props: MockDesktopProps) {
  const { panes, floats, openTerminal, core, settingsTab, emptyLauncher } =
    props;
  const { detachedTab } = props;
  const route =
    detachedTab !== undefined
      ? openDetached(detachedTab.key)
      : settingsTab === undefined
        ? (props.route ?? LAUNCHER)
        : openSettings(SETTINGS_PANE[settingsTab]);
  const wiring = useMemo(() => {
    const mock = devMock("?mock") as DevMock;
    const workspace =
      panes === undefined
        ? mock.workspace
        : {
            ...mock.workspace,
            readLayout: () =>
              Promise.resolve({
                ok: true as const,
                available: true as const,
                layout: layoutOf(panes, floats ?? [], props.railApps ?? []),
              }),
          };
    const terminalBridge = fakeTerminal(PROJECT_GROCERY);
    const terminalStore = new TerminalStore(null, null);
    const terminal = {
      bridge: terminalBridge,
      store: terminalStore,
      displays: new TerminalDisplays(terminalStore, terminalBridge),
      createView: createXtermView,
      confirmClose: () => Promise.resolve(false),
    };
    if (openTerminal !== undefined) terminal.store.request(openTerminal);
    const { title, key, kind, folder } = detachedTab ?? {};
    const detached = fakeDetached(
      detachedTab === undefined
        ? undefined
        : {
            project: PROJECT_GROCERY,
            tab: {
              key: key!,
              kind: kind!,
              title,
              folder,
            } as DetachedTaken["tab"],
            transfer: null,
          },
    );
    return {
      mock,
      detached,
      projects:
        emptyLauncher === true
          ? {
              ...mock.projects,
              list: () => Promise.resolve({ ok: true as const, value: [] }),
            }
          : mock.projects,
      apps:
        emptyLauncher === true
          ? {
              ...mock.apps,
              list: () => Promise.resolve({ ok: true as const, value: [] }),
            }
          : mock.apps,
      workspace,
      terminal,
      conversation: { drafts: new DraftStore() },
      events: createEventClient(mock.events),
      settingsPanels: mock.settingsPanels,
    };
  }, [panes, floats, openTerminal, emptyLauncher, detachedTab, props.railApps]);
  const { mock } = wiring;
  const annotate = props.annotate ?? mock.annotate;
  return (
    <BrowserApiProvider value={props.browser ?? mock.browser}>
      <ArtifactApiProvider value={props.artifact ?? null}>
        <AnnotateApiProvider value={annotate}>
          <AppViewsProvider value={mock.appViews}>
            <ConversationProvider deps={wiring.conversation}>
              <EventsProvider client={wiring.events}>
                <Desktop
                  source={core ?? mock.core}
                  initial={route}
                  workspace={wiring.workspace}
                  editor={mock.editor}
                  terminal={wiring.terminal}
                  detached={wiring.detached}
                  catalog={mock.catalog}
                  projects={wiring.projects}
                  apps={wiring.apps}
                  settings={mock.settings}
                  settingsPanels={wiring.settingsPanels}
                  appDetail={mock.appDetail}
                  views={mock.views}
                  annotate={annotate}
                />
              </EventsProvider>
            </ConversationProvider>
          </AppViewsProvider>
        </AnnotateApiProvider>
      </ArtifactApiProvider>
    </BrowserApiProvider>
  );
}
