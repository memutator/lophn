// 진짜 Desktop 화면을 mock 데이터로 그린다. 조립은 packages/shell/renderer/desktop/entry.tsx의 mock
// 갈래와 같다. entry는 import하면 바로 mount하므로 이 gallery가 같은 조립을 따로 둔다. 앱 코드는
// 고치지 않고, preload가 없는 일반 browser에 없는 통로(터미널 PTY, overlay)만 여기서 채운다.

import { useEffect, useMemo } from "react";
import {
  appTrayList,
  type TrayTone,
} from "../../../packages/protocol/apps/tray.ts";
import type { LophnShellAnnotateApi } from "../../../packages/shell/ipc/annotation.ts";
import type { LophnArtifactApi } from "../../../packages/shell/ipc/artifact.ts";
import type { LophnBrowserApi } from "../../../packages/shell/ipc/browser.ts";
import type {
  DetachedTaken,
  LophnDetachedApi,
} from "../../../packages/shell/ipc/detached.ts";
import type { AppDetailSource } from "../../../packages/shell/renderer/app-frame/app-detail/source.ts";
import {
  AnnotateApiProvider,
  ArtifactApiProvider,
} from "../../../packages/shell/renderer/artifact/artifact-api.tsx";
import { BrowserApiProvider } from "../../../packages/shell/renderer/browser/browser-api.tsx";
import { DraftStore } from "../../../packages/shell/renderer/conversation/drafts.ts";
import { ConversationProvider } from "../../../packages/shell/renderer/conversation/window-deps.tsx";
import type { CoreSource } from "../../../packages/shell/renderer/desktop/connection/connection.ts";
import { createEventClient } from "../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createEventStores } from "../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { PROJECT_GROCERY } from "../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import {
  type DevMock,
  devMock,
} from "../../../packages/shell/renderer/desktop/dev-mock/mod.ts";
import type { JobsSource } from "../../../packages/shell/renderer/desktop/jobs/source.ts";
import { Desktop } from "../../../packages/shell/renderer/desktop/main.tsx";
import { createMachineHub } from "../../../packages/shell/renderer/desktop/machines/data.ts";
import {
  MachineHubProvider,
  MachineScope,
} from "../../../packages/shell/renderer/desktop/machines/scope.tsx";
import {
  HOME,
  openDetached,
  openSettings,
  type Route,
} from "../../../packages/shell/renderer/desktop/router.ts";
import type { SettingsPane } from "../../../packages/shell/renderer/desktop/settings/model.ts";
import { QuickPrefsProvider } from "../../../packages/shell/renderer/desktop/settings/quick-launch/store.tsx";
import { MAIN_DESK } from "../../../packages/shell/renderer/shell/desk-model.ts";
import { createLayoutSource } from "../../../packages/shell/renderer/shell/layout-source.ts";
import type { WorkspaceSource } from "../../../packages/shell/renderer/workspace/source.ts";
import { withSyncLists } from "./core-answers/sync-lists.ts";
import { fakeTerminalDeps } from "./fake-terminal.ts";
// 터미널 탭이 쓰는 xterm 기본 배치.
import "@xterm/xterm/css/xterm.css";

export { PROJECT_GROCERY };

/** 작업대 탭 배치. 저장된 layout의 탭과 같은 모양이다(shell/layout-source.ts). */
interface TabSpec {
  readonly key: string;
  readonly kind:
    | "document_editor"
    | "terminal"
    | "app_panel"
    | "project_settings"
    | "app_detail"
    | "jobs"
    | "inbox"
    | "browser"
    | "artifact"
    | "app_screen"
    | "agent";
  readonly title: string;
  readonly folder?: string;
  /** app_panel 탭이 여는 앱과 그 화면 key. */
  readonly app?: string;
  readonly screen?: string;
  /** browser 탭이 처음 여는 주소. 빈 글이면 빈 주소 칸이다. */
  readonly url?: string;
  /** artifact 탭이 여는 대상. name은 fake project의 artifact, path는 사람의 폴더에 있는 .html이다. */
  readonly name?: string;
  readonly path?: string;
  /** agent 탭이 보는 agent(기본 lophn). */
  readonly agent?: string;
  /** agent 탭의 workspace. 없으면 Home이다. */
  readonly workspace?: { readonly kind: "app"; readonly id: string };
  /** 탭의 주인 session(탭 공통 칸 `owner`). 없으면 사람의 탭이다. */
  readonly owner?: string;
  /** browser 탭의 profile(bpf id). 없으면 기본 profile이다. */
  readonly profile?: string;
  /** 사람이 session에 넘긴 browser 탭의 core 탭 id(탭 공통 칸 `handed_tab`). */
  readonly handedTab?: string;
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
}

interface MockDesktopProps {
  readonly route?: Route;
  /** 작업대의 칸 배치. 없으면 시드 배치다. */
  readonly panes?: readonly PaneSpec[];
  /** 칸 위에 뜬 탭. 없으면 없다. */
  readonly floats?: readonly FloatSpec[];
  /** 이 키의 터미널 탭을 열린 채로 시작한다. */
  readonly openTerminal?: string;
  /** project와 앱이 하나도 없는 Home으로 그린다. */
  readonly emptyHome?: boolean;
  /** 주면 이 탭들을 Home workspace의 layout으로 쓴다(route는 Home). */
  readonly homeTabs?: readonly TabSpec[];
  /** workspace 창의 Jobs overlay·Jobs 탭·Jobs panel 통로. page가 fake(`fakeJobs`)로 job을 정한다. 없으면 dev mock 것이다. */
  readonly jobs?: JobsSource;
  /** 앱 workspace의 App details 탭을 여는 통로. page가 fake(`fakeDetail`)로 정한다. 없으면 dev mock 것이다. */
  readonly appDetail?: AppDetailSource;
  /** 이 연결로 event를 읽는다(Logs의 run session 상태). */
  readonly events?: (events: CoreSource) => CoreSource;
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
  /** 앱 하나의 `sidebar` 화면(key, 이름)을 설치된 것으로 둔다(끄지 않았으니 나온다). */
  readonly sidebarPanel?: {
    readonly app: string;
    readonly screen: string;
    readonly label: string;
  };
  /** 앱 화면(`tray` 자리)을 설치된 것으로 둔다(끄지 않았으니 나온다). text가 있으면 앱이 그 값을 낸 것이다. */
  readonly tray?: readonly {
    readonly app: string;
    readonly screen: string;
    readonly label: string;
    readonly text?: string;
    readonly tone?: TrayTone;
  }[];
}

// 앱이 낸 tray 값. core의 `app_tray/list`를 이 값으로 답한다.
function withTrayValues(
  source: CoreSource,
  tray: MockDesktopProps["tray"],
): CoreSource {
  if (tray === undefined) return source;
  const values = tray.flatMap((item) =>
    item.text === undefined
      ? []
      : [
          {
            app: item.app,
            text: item.text,
            tone: item.tone ?? "neutral",
            at: "2026-11-07T00:00:00.000Z",
          },
        ],
  );
  return {
    ...source,
    call: (input) =>
      input.kind === "memory" &&
      input.resource === appTrayList.resource &&
      input.method === appTrayList.method
        ? Promise.resolve({ ok: true, value: { values } })
        : source.call(input),
  };
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

// 저장된 layout의 탭 모양으로 바꾼다. 주인과 browser profile은 kind와 상관없이 단다.
function storedTab(tab: TabSpec) {
  return {
    ...storedKind(tab),
    ...(tab.owner === undefined ? {} : { owner: tab.owner }),
    ...(tab.profile === undefined ? {} : { profile: tab.profile }),
    ...(tab.handedTab === undefined ? {} : { handed_tab: tab.handedTab }),
  };
}

// 문서 탭은 key가 곧 path이고, 터미널 탭은 연 폴더를 갖는다.
function storedKind(tab: TabSpec) {
  if (tab.kind === "agent") {
    return {
      kind: tab.kind,
      key: tab.key,
      agent: tab.agent ?? "lophn",
      workspace: tab.workspace ?? { kind: "home" },
    };
  }
  if (tab.kind === "app_screen") {
    return { kind: tab.kind, key: tab.key, app: tab.app };
  }
  if (tab.kind === "browser") {
    return { kind: tab.kind, key: tab.key, url: tab.url ?? "" };
  }
  if (tab.kind === "artifact") {
    return tab.name !== undefined
      ? {
          kind: tab.kind,
          key: tab.key,
          project: PROJECT_GROCERY,
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
  if (
    tab.kind === "project_settings" ||
    tab.kind === "app_detail" ||
    tab.kind === "jobs" ||
    tab.kind === "inbox"
  ) {
    return { kind: tab.kind, key: tab.key };
  }
  return tab.kind === "terminal"
    ? {
        kind: tab.kind,
        key: tab.key,
        project_folder: tab.folder ?? "/home/mina/Documents/grocery",
        title: tab.title,
      }
    : { kind: tab.kind, key: tab.key, path: tab.key };
}

// 칸이 둘이면 둘째 칸의 고른 탭을 첫 칸의 고른 탭 바로 뒤에 붙여 group 하나로 만든다.
function layoutOf(panes: readonly PaneSpec[], floats: readonly FloatSpec[]) {
  const first = panes[0];
  const second = panes[1];
  const all = panes.flatMap((pane) => pane.tabs);
  const partner =
    second === undefined
      ? undefined
      : all.find((tab) => tab.key === second.selected);
  const rest = all.filter((tab) => tab !== partner);
  const at = rest.findIndex((tab) => tab.key === first?.selected) + 1;
  const tabs =
    partner === undefined
      ? all
      : [...rest.slice(0, at), partner, ...rest.slice(at)];
  return {
    active_desk: MAIN_DESK,
    desks: {
      [MAIN_DESK]: {
        label: "Main",
        tabs: tabs.map(storedTab),
        selected_tab: first?.selected ?? null,
        groups:
          partner === undefined || first === undefined
            ? []
            : [
                {
                  layout: {
                    dir: "row",
                    ratio: 0.5,
                    a: { tab: first.selected },
                    b: { tab: partner.key },
                  },
                  focus: first.selected,
                },
              ],
        floats: floats.map((float) => ({
          tab: storedTab(float.tab),
          rect: float.rect,
          minimized: float.minimized ?? false,
        })),
        detached: [],
      },
    },
  };
}

// gallery의 Settings 탭 이름을 Settings 항목(pane)으로 잇는다.
const SETTINGS_PANE = {
  coding: "coding",
  browser: "browser",
} as const satisfies Record<string, SettingsPane>;

export type SettingsTab = keyof typeof SETTINGS_PANE;

export function MockDesktop(props: MockDesktopProps) {
  const { panes, floats, openTerminal, core, settingsTab, emptyHome } = props;
  const { homeTabs } = props;
  const { detachedTab } = props;
  const route =
    detachedTab !== undefined
      ? openDetached(detachedTab.key)
      : settingsTab === undefined
        ? (props.route ?? HOME)
        : openSettings(SETTINGS_PANE[settingsTab]);
  const wiring = useMemo(() => {
    const mock = devMock("?mock") as DevMock;
    const homeLayout =
      homeTabs === undefined
        ? undefined
        : layoutOf([{ tabs: homeTabs, selected: homeTabs[0]?.key ?? "" }], []);
    const workspace: WorkspaceSource = {
      ...mock.workspace,
      ...(panes === undefined && homeLayout === undefined
        ? {}
        : {
            layout: createLayoutSource(() => ({
              readWorkspace: () =>
                Promise.resolve({
                  ok: true as const,
                  available: true as const,
                  layout: homeLayout ?? layoutOf(panes!, floats ?? []),
                }),
              saveWorkspace: () => Promise.resolve({ ok: true as const }),
            })),
          }),
    };
    const terminal = fakeTerminalDeps();
    if (openTerminal !== undefined) terminal.store.request(openTerminal);
    const { title, key, kind, folder, owner } = detachedTab ?? {};
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
              owner,
            } as DetachedTaken["tab"],
            transfer: null,
          },
    );
    const projects =
      emptyHome === true
        ? {
            ...mock.projects,
            list: () => Promise.resolve({ ok: true as const, value: [] }),
          }
        : mock.projects;
    const apps =
      emptyHome === true
        ? {
            ...mock.apps,
            list: () => Promise.resolve({ ok: true as const, value: [] }),
          }
        : mock.apps;
    return {
      mock,
      detached,
      projects,
      apps,
      workspace,
      terminal,
      conversation: { drafts: new DraftStore() },
      events: createEventClient(
        withSyncLists(
          withTrayValues(
            props.events?.(mock.events) ?? mock.events,
            props.tray,
          ),
          projects,
          apps,
        ),
      ),
      settingsPanels: mock.settingsPanels,
    };
  }, [
    panes,
    floats,
    openTerminal,
    emptyHome,
    homeTabs,
    detachedTab,
    props.events,
    props.tray,
  ]);
  const { mock } = wiring;
  const { sidebarPanel, tray } = props;
  // 이 page가 설치된 것으로 두는 화면. dev mock의 앱 화면 목록에 없는 자리의 화면을 더한다.
  const extraScreens = useMemo(
    () => [
      ...(sidebarPanel === undefined
        ? []
        : [{ ...sidebarPanel, place: "sidebar" as const }]),
      ...(tray ?? []).map((item) => ({ ...item, place: "tray" as const })),
    ],
    [sidebarPanel, tray],
  );
  const appViews = useMemo(
    () =>
      extraScreens.length === 0
        ? mock.appViews
        : {
            ...mock.appViews,
            screens: async () => {
              const read = await mock.appViews.screens!();
              if (!read.ok) return read;
              return {
                ok: true as const,
                value: read.value.map((app) => ({
                  ...app,
                  screens: [
                    ...app.screens,
                    ...extraScreens
                      .filter(
                        (item) =>
                          item.app === app.app &&
                          // dev mock이 이미 선언한 화면은 한 번만 둔다(선언하면 바로 나오므로 겹치면 key가 같다).
                          !app.screens.some((s) => s.key === item.screen),
                      )
                      .map((item) => ({
                        key: item.screen,
                        label: item.label,
                        places: [item.place],
                      })),
                  ],
                })),
              };
            },
          },
    [mock, extraScreens],
  );
  const annotate = props.annotate ?? mock.annotate;
  // entry처럼 이 컴퓨터만 있는 hub를 세운다. 빠른 실행은 기본값(QuickPrefsProvider)이다.
  const { jobs, appDetail } = props;
  const hub = useMemo(
    () =>
      createMachineHub({
        bridge: undefined,
        machines: null,
        views: undefined,
        here: () => ({
          machine: null,
          here: true,
          core: core ?? mock.core,
          events: wiring.events,
          stores: createEventStores(wiring.events),
          workspace: wiring.workspace,
          editor: mock.editor,
          projects: wiring.projects,
          apps: wiring.apps,
          catalog: mock.catalog,
          appDetail: appDetail ?? mock.appDetail,
          settings: mock.settings,
          jobs: jobs ?? mock.jobs,
          settingsPanels: wiring.settingsPanels,
          quickPrefs: undefined,
          codingPrefs: undefined,
          agentViewSource: mock.agentViewSource,
          folders: null,
          picker: undefined,
          terminal: wiring.terminal,
          appViews,
          projectIcons: mock.projectIcons,
          grant: () => Promise.resolve(true),
        }),
      }),
    [wiring, core, appViews, jobs, appDetail],
  );
  useEffect(() => () => hub.stop(), [hub]);
  return (
    <BrowserApiProvider value={props.browser ?? mock.browser}>
      <ArtifactApiProvider value={props.artifact ?? null}>
        <AnnotateApiProvider value={annotate}>
          <MachineHubProvider hub={hub}>
            <MachineScope machine={null}>
              <QuickPrefsProvider source={undefined}>
                <ConversationProvider deps={wiring.conversation}>
                  <Desktop
                    initial={route}
                    detached={wiring.detached}
                    views={mock.views}
                  />
                </ConversationProvider>
              </QuickPrefsProvider>
            </MachineScope>
          </MachineHubProvider>
        </AnnotateApiProvider>
      </ArtifactApiProvider>
    </BrowserApiProvider>
  );
}
