import { HighlighterProvider } from "@lophn/ui/reading";
import type { LophnShellAnnotateApi } from "../../ipc/annotation.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { AppearanceApi } from "../../ipc/appearance.ts";
import type { LophnArtifactApi } from "../../ipc/artifact.ts";
import type { LophnBrowserApi } from "../../ipc/browser.ts";
import type { CoreApi } from "../../ipc/core-api.ts";
import type { LophnDetachedApi } from "../../ipc/detached.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { IntentApi, ShortcutApi } from "../../ipc/shortcuts.ts";
import { coreAppDetailSource } from "../app-frame/app-detail/core-source.ts";
import { machineAppViews } from "../app-frame/machine-deps.ts";
import { coreAppsSource } from "../apps/core-source.ts";
import {
  AnnotateApiProvider,
  ArtifactApiProvider,
} from "../artifact/artifact-api.tsx";
import {
  BrowserApiProvider,
  BrowserOverlayProvider,
} from "../browser/browser-api.tsx";
import { coreAgentTabSourceFactory } from "../conversation/agent-tab-core-source.ts";
import { signInInputRequest } from "../conversation/agent-tab-core-source-sign-in.ts";
import { DraftStore } from "../conversation/drafts.ts";
import { ConversationProvider } from "../conversation/window-deps.tsx";
import { windowEditorDeps } from "../editor/window-deps.ts";
import { mount } from "../entry.tsx";
import { createWorkerHighlighter } from "../highlight/client.ts";
import { coreProjectIcons } from "../parts/project-icon/project-icon.tsx";
import { machineTerminalDeps } from "../terminal/machine-deps.ts";
import { coreWorkspaceSource } from "../workspace/core-source.ts";
import { coreFileSearchSource } from "../workspace/search/core-source.ts";
import { windowCoreSource } from "./connection/connection.ts";
import { createEventClient } from "./connection/events/client.ts";
import { createEventStores } from "./connection/events/hooks.tsx";
import { coreJobsSource } from "./jobs/core-source.ts";
import { MachinesProvider } from "./machines/context.tsx";
import { createMachineHub, type MachineData } from "./machines/data.ts";
import { MachineHubProvider, MachineScope } from "./machines/scope.tsx";
import { windowMachinesSource } from "./machines/window-source.ts";
import { Desktop } from "./main.tsx";
import { catalogSource } from "./palette/core-catalog.ts";
import type { PaletteDeps } from "./palette/host.tsx";
import { fileSearch } from "./palette/search.ts";
import {
  openApp,
  openAppWindow,
  openDetached,
  openProject,
  openSettings,
  type Route,
} from "./router.ts";
import { coreAgentsSettingsSource } from "./settings/agents/core-source.ts";
import { coreAppearanceSource } from "./settings/appearance/core-source.ts";
import type { QueryLocalFonts } from "./settings/appearance/local-fonts.ts";
import { windowBrowserSettings } from "./settings/browser/window-source.ts";
import { coreCodingConnectionsSource } from "./settings/connections/core-source.ts";
import { coreSettingsSource } from "./settings/core-source.ts";
import { coreDiagnosticsSource } from "./settings/diagnostics/core-source.ts";
import { coreKeyboardSource } from "./settings/keyboard/core-source.ts";
import { coreProviderSettingsSource } from "./settings/providers/core-source.ts";
import { coreQuickPrefsSource } from "./settings/quick-launch/core-source.ts";
import { QuickPrefsProvider } from "./settings/quick-launch/store.tsx";
import { coreRemoteSource } from "./settings/remote/core-source.ts";
import { coreSyncSource } from "./settings/sync/core-source.ts";
import { coreShellRulesSource } from "./settings/shell-rules/core-source.ts";
import {
  coreProjectsSource,
  windowFolderPicker,
} from "./workspaces/projects/core-source.ts";
import { RemoteGroupsProvider } from "./workspaces/projects/remote-group.tsx";
// xterm 기본 배치. CSP 때문에 xterm이 넣는 <style>은 xterm-view가 옮긴다.
import "@xterm/xterm/css/xterm.css";
import styles from "./entry.module.css";

declare global {
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
}

// 개발 확인 전용. 주소의 `mock`이면 core 대신 메모리 가짜 통로로 모든 화면을 채운다.
// build.ts가 prod에서 DEV를 false로 접어 이 import가 bundle에서 빠진다.
const mock = import.meta.env.DEV
  ? (await import("./dev-mock/mod.ts")).devMock()
  : null;
const seed =
  import.meta.env.DEV && !mock
    ? (await import("./dev-seed.ts")).devSeed()
    : null;
// 시드 작업대와 mock 모드는 둘 다 가짜 작업대와 문서 탭 통로를 쓴다(core·편집 파일 통로 없음).
const bench = mock ? { source: mock.workspace, editor: mock.editor } : seed;
// 기계 목록과 이 창이 보는 기계(main이 정한다). 기계에 묶인 창은 root 범위가 그 기계다(그런 창이 없어지면 늘 이 컴퓨터다).
const machines = mock ? null : await windowMachinesSource();
const rootMachine = machines?.thisWindow()?.id ?? null;
const bridges = globalThis as {
  lophnCore?: CoreApi;
  lophnShell?: OverlayApi &
    Partial<LophnShellViewsApi> &
    Partial<LophnShellAnnotateApi>;
  lophnShortcuts?: ShortcutApi;
  lophnIntents?: IntentApi;
  lophnBrowser?: LophnBrowserApi;
  lophnArtifact?: LophnArtifactApi;
  lophnDetached?: LophnDetachedApi;
};
// shell preload의 앱 view 통로. desktop 창 preload에만 있다.
const views: LophnShellViewsApi | undefined =
  mock?.views ??
  (typeof bridges.lophnShell?.openApp === "function"
    ? (bridges.lophnShell as LophnShellViewsApi)
    : undefined);

// 이 컴퓨터의 묶음. 창에 붙은 통로(OS 폴더 고르기, 문서 편집, 글꼴, 터미널 입력)가 여기서 붙는다. 다른 기계의 묶음은 hub가
// 그 기계를 처음 쓸 때 짓는다(machines/data.ts).
function hereData(): MachineData {
  const core = mock?.core ?? windowCoreSource();
  // 대기 목록·session 상태·toast가 이 연결 하나를 나눠 쓴다.
  const events = createEventClient(mock?.events ?? core);
  const terminal = machineTerminalDeps(null, core, events);
  const picker = windowFolderPicker();
  // Home Workspaces panel의 project 목록·등록·보관과 앱 공간의 project 고르기.
  const projects = mock?.projects ?? coreProjectsSource(core, picker);
  // Home Workspaces panel의 앱 목록·보관과 앱 공간. 앱 view는 shell preload의 view 통로로 main이 붙인다.
  const apps = mock?.apps ?? coreAppsSource(core);
  const appDetail = mock?.appDetail ?? coreAppDetailSource(core);
  return {
    machine: null,
    here: true,
    core,
    events,
    stores: createEventStores(events, terminal?.store),
    workspace: bench?.source ?? coreWorkspaceSource(core),
    editor: bench ? bench.editor : windowEditorDeps(core),
    projects,
    apps,
    // 팔레트의 project·앱 행.
    catalog: mock?.catalog ?? catalogSource(projects, apps),
    appDetail,
    // settings 화면의 일반 설정·확장. credential은 보호 창이 받는다.
    settings: mock?.settings ?? coreSettingsSource(core),
    // workspace 창의 Jobs overlay와 Jobs 탭, sidebar Jobs panel.
    jobs: mock?.jobs ?? coreJobsSource(core),
    // settings 항목마다의 통로. key·로그인 응답은 보호 창이 받는다.
    settingsPanels: mock?.settingsPanels ?? {
      providers: coreProviderSettingsSource(core),
      agents: coreAgentsSettingsSource(core),
      diagnostics: coreDiagnosticsSource(core),
      shellRules: coreShellRulesSource(core),
      // 설치된 글꼴은 Chromium Local Font Access로 읽는다. 권한은 desktop 창 session이 준다.
      appearance: coreAppearanceSource(
        core,
        (
          globalThis as { queryLocalFonts?: QueryLocalFonts }
        ).queryLocalFonts?.bind(globalThis),
        (globalThis as { lophnAppearance?: AppearanceApi }).lophnAppearance,
      ),
      keyboard: coreKeyboardSource(core),
      remote: coreRemoteSource(core),
      sync: coreSyncSource(core),
      coding: coreCodingConnectionsSource(core),
      browser: windowBrowserSettings(),
    },
    // 빠른 실행 전역 값(단추 순서·고정, 앱 panel 여는 자리, coding agent 즐겨찾기). Settings와 workspace 창이 같이 쓴다.
    quickPrefs: mock?.quickPrefs ?? coreQuickPrefsSource(core),
    // Agent 탭과 앱 공간의 Agent 칸이 agent마다 통로를 얻는 함수.
    agentViewSource:
      mock?.agentViewSource ??
      coreAgentTabSourceFactory(core, { signIn: signInInputRequest }),
    folders: null,
    picker,
    terminal,
    appViews: mock?.appViews ?? machineAppViews(null, core, views, appDetail),
    // project 표식의 icon 읽기와 project 설정의 올리기. 앱 icon과 달리 project는 선언이 없고 올린 것만 있다.
    projectIcons: mock?.projectIcons ?? coreProjectIcons(core),
    grant: () => Promise.resolve(true),
  };
}

const hub = createMachineHub({
  here: hereData,
  bridge: mock ? undefined : bridges.lophnCore,
  machines,
  views,
});
const root = hub.get(rootMachine);
// 창마다 하나인 대화 메모리. 공간을 오가도 작성 중 말이 남는다.
const conversation = { drafts: new DraftStore() };

// main이 띄우는 앱 전용 창의 hash. `#app-window=<app>/<release>/<screen>`이고 각 부분은
// encodeURIComponent된 값이다.
function appWindowRoute(value: string): Route | undefined {
  const parts = value.split("/");
  if (parts.length !== 3) return undefined;
  const [app, release, screen] = parts.map((part) => decodeURIComponent(part));
  return app === undefined ||
    release === undefined ||
    screen === undefined ||
    app === "" ||
    release === "" ||
    screen === ""
    ? undefined
    : openAppWindow(app, release, screen);
}

// 개발 확인용 시작 화면. `#settings`면 Settings부터 연다.
// `#project=<id>`면 그 프로젝트 작업대부터, `#app=<id>`면 그 앱 공간부터 연다.
// `#detached=<탭 key>`는 main이 띄우는 detached 창이다. 기본은 Home이다.
const start: Route | undefined = seed
  ? openProject(seed.project)
  : location.hash.startsWith("#project=")
    ? openProject(location.hash.slice("#project=".length))
    : location.hash.startsWith("#app=")
      ? openApp(location.hash.slice("#app=".length))
      : location.hash.startsWith("#app-window=")
        ? appWindowRoute(location.hash.slice("#app-window=".length))
        : location.hash.startsWith("#detached=")
          ? openDetached(
              decodeURIComponent(location.hash.slice("#detached=".length)),
            )
          : location.hash === "#settings"
            ? openSettings()
            : undefined;

const annotate: LophnShellAnnotateApi | undefined =
  mock?.annotate ??
  (typeof bridges.lophnShell?.setMode === "function"
    ? (bridges.lophnShell as LophnShellAnnotateApi)
    : undefined);
const browser: LophnBrowserApi | null =
  mock?.browser ?? bridges.lophnBrowser ?? null;
const artifact: LophnArtifactApi | null = bridges.lophnArtifact ?? null;
// 창 안 팔레트. root 범위의 project·앱 행과 파일을 찾는다. overlay와 shortcut 통로는 desktop preload가 연다.
const palette: PaletteDeps | undefined =
  bridges.lophnShell && bridges.lophnShortcuts
    ? {
        overlay: bridges.lophnShell,
        shortcuts: bridges.lophnShortcuts,
        search: fileSearch(root.catalog, coreFileSearchSource(root.core)),
      }
    : undefined;

// 파일 읽기와 chat의 code block이 같은 Worker를 쓴다. Worker는 첫 highlight 때 뜬다.
const highlighter = createWorkerHighlighter();

const tree = (
  <MachineHubProvider hub={hub}>
    <MachineScope machine={rootMachine}>
      <div className={styles.root}>
        <HighlighterProvider value={highlighter}>
          <BrowserApiProvider value={browser}>
            <ArtifactApiProvider value={artifact}>
              <AnnotateApiProvider value={annotate}>
                <BrowserOverlayProvider value={bridges.lophnShell ?? null}>
                  <ConversationProvider deps={conversation}>
                    <QuickPrefsProvider source={root.quickPrefs}>
                      <RemoteGroupsProvider>
                        <Desktop
                          initial={start}
                          windowWidth={seed ? 1440 : undefined}
                          palette={palette}
                          intents={bridges.lophnIntents}
                          views={views}
                          overlay={bridges.lophnShell}
                          detached={bridges.lophnDetached}
                        />
                      </RemoteGroupsProvider>
                    </QuickPrefsProvider>
                  </ConversationProvider>
                </BrowserOverlayProvider>
              </AnnotateApiProvider>
            </ArtifactApiProvider>
          </BrowserApiProvider>
        </HighlighterProvider>
      </div>
    </MachineScope>
  </MachineHubProvider>
);
mount(
  machines === null ? (
    tree
  ) : (
    <MachinesProvider source={machines}>{tree}</MachinesProvider>
  ),
);
