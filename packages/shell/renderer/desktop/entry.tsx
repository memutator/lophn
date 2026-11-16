import { mount } from "../entry.tsx";
import { HighlighterProvider } from "@lophn/ui/reading";
import { createWorkerHighlighter } from "../highlight/client.ts";
import { Desktop } from "./main.tsx";
import { type CoreSource, windowCoreSource } from "./connection/connection.ts";
import { windowEditorDeps } from "../editor/window-deps.ts";
import {
  openApp,
  openAppWindow,
  openDetached,
  openProject,
  openSettings,
  type Route,
} from "./router.ts";
import { catalogSource } from "./palette/core-catalog.ts";
import type { HookPromptApi } from "./hook-prompt/hook-prompt-host.tsx";
import { type TerminalDeps, windowTerminalDeps } from "../terminal/deps.ts";
import { TerminalStore } from "../terminal/store.ts";
import {
  createXtermView,
  type TerminalClipboard,
} from "../terminal/xterm-view.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { AppearanceApi } from "../../ipc/appearance.ts";
import {
  type AppViewsDeps,
  AppViewsProvider,
  coreAppRead,
  coreAppScreens,
} from "../app-frame/app-views.tsx";
import { coreAppIcon } from "../app-frame/app-icon.tsx";
import {
  coreProjectIcons,
  ProjectIconsProvider,
} from "../parts/project-icon/project-icon.tsx";
import type { IntentApi, ShortcutApi } from "../../ipc/shortcuts.ts";
import type { PaletteDeps } from "./palette/host.tsx";
import { fileSearch } from "./palette/search.ts";
import { coreFileSearchSource } from "../workspace/search/core-source.ts";
import { createEventClient } from "./connection/events/client.ts";
import { EventsProvider } from "./connection/events/hooks.tsx";
import { ConversationProvider } from "../conversation/window-deps.tsx";
import { coreAgentTabSourceFactory } from "../conversation/agent-tab-core-source.ts";
import { signInInputRequest } from "../conversation/agent-tab-core-source-sign-in.ts";
import { DraftStore } from "../conversation/drafts.ts";
import { coreWorkspaceSource } from "../workspace/core-source.ts";
import { coreAppsSource } from "../apps/core-source.ts";
import {
  coreProjectsSource,
  windowFolderPicker,
} from "./workspaces/projects/core-source.ts";
import { coreSettingsSource } from "./settings/core-source.ts";
import { coreAppearanceSource } from "./settings/appearance/core-source.ts";
import type { QueryLocalFonts } from "./settings/appearance/local-fonts.ts";
import { coreKeyboardSource } from "./settings/keyboard/core-source.ts";
import { coreRemoteSource } from "./settings/remote/core-source.ts";
import { coreJobsSource } from "./jobs/core-source.ts";
import { coreShellRulesSource } from "./settings/shell-rules/core-source.ts";
import { windowBrowserSettings } from "./settings/browser/window-source.ts";
import { coreProviderSettingsSource } from "./settings/providers/core-source.ts";
import { coreAgentsSettingsSource } from "./settings/agents/core-source.ts";
import { coreDiagnosticsSource } from "./settings/diagnostics/core-source.ts";
import { coreAppDetailSource } from "../app-frame/app-detail/core-source.ts";
import {
  coreCodingConnectionsSource,
  windowCodingApi,
} from "./settings/connections/core-source.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { LophnArtifactApi } from "../../ipc/artifact.ts";
import type { LophnBrowserApi } from "../../ipc/browser.ts";
import type { LophnDetachedApi } from "../../ipc/detached.ts";
import {
  AnnotateApiProvider,
  ArtifactApiProvider,
} from "../artifact/artifact-api.tsx";
import {
  BrowserApiProvider,
  BrowserOverlayProvider,
} from "../browser/browser-api.tsx";
import type { LophnShellAnnotateApi } from "../../ipc/annotation.ts";
import { coreQuickPrefsSource } from "./settings/quick-launch/core-source.ts";
import { QuickPrefsProvider } from "./settings/quick-launch/store.tsx";
import {
  DEFAULT_QUICK_PREFS,
  type QuickPrefs,
  type QuickPrefsSource,
} from "./settings/quick-launch/source.ts";
import type { JobsSource } from "./jobs/source.ts";
import { MachinesProvider } from "./machines/context.tsx";
import {
  createLayoutSource,
  memoryWorkspaceLayoutBridge,
} from "../shell/layout-source.ts";
import { windowMachinesSource } from "./machines/window-source.ts";
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
// 이 창이 보는 기계(main이 정한다). null이면 이 컴퓨터의 창이다. 다른 기계의 창은 그 기계의 core를 같은 통로로 부르고,
// 이 컴퓨터의 shell host가 필요하거나 기기가 부를 수 없는 통로는 짓지 않는다.
const machines = mock ? null : await windowMachinesSource();
const remote = machines?.thisWindow() != null;
const remoteLayouts = memoryWorkspaceLayoutBridge();
const core = mock?.core ?? windowCoreSource();
const editor = remote ? undefined : windowEditorDeps(core);
// 창마다 하나인 event 연결. 대기 목록·session 상태·toast가 이 연결 하나를 나눠 쓴다.
const events = createEventClient(mock?.events ?? core);
// Home Workspaces panel의 project 목록·등록·보관과 앱 공간의 project 고르기.
const projects =
  mock?.projects ?? coreProjectsSource(core, windowFolderPicker());
// Home Workspaces panel의 앱 목록·보관과 앱 공간. 앱 view는 shell preload의 view 통로로 main이 붙인다.
const apps = mock?.apps ?? coreAppsSource(core);
// 팔레트의 project·앱 행.
const catalog = mock?.catalog ?? catalogSource(projects, apps);
const appDetail = remote
  ? undefined
  : (mock?.appDetail ?? coreAppDetailSource(core));
// settings 화면의 일반 설정·확장. credential은 보호 창이 받는다.
const settings = remote
  ? undefined
  : (mock?.settings ?? coreSettingsSource(core));
// workspace 창의 Jobs overlay와 Jobs 탭, sidebar Jobs panel.
const jobs =
  mock?.jobs ?? (remote ? jobsSwitchOnly(core) : coreJobsSource(core));
// settings 항목마다의 통로. key·로그인 응답은 보호 창이 받고, coding agent 감지는 main이 따로 검증하는 통로(`lophnCoding`)다.
const settingsPanels = remote
  ? undefined
  : (mock?.settingsPanels ?? {
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
      coding: coreCodingConnectionsSource({ core, coding: windowCodingApi() }),
      browser: windowBrowserSettings(),
    });
// 빠른 실행 전역 값(단추 순서·고정, 앱 panel 여는 자리, coding agent 즐겨찾기). Settings와 workspace 창이 같이 쓴다.
// 다른 기계의 설정은 기기가 읽지도 쓰지도 못해 그 창은 기본값을 메모리에만 둔다.
const quickPrefs =
  mock?.quickPrefs ??
  (remote ? memoryQuickPrefs() : coreQuickPrefsSource(core));
// 작업대는 제품 core 통로로 읽고 쓴다. 다른 기계의 창은 팔레트 파일 묶음(문서 목록)을 읽지 않는다: 그 파일은 그 기계에서만 연다.
// 그 창의 layout은 저장하지 않고 창이 사는 동안 메모리에만 둔다(Settings에 갔다 와도 탭이 남고, 다시 열면 Home이다).
const workspace =
  bench?.source ??
  (remote
    ? {
        ...coreWorkspaceSource(core),
        files: async () => ({ ok: true, value: [] }),
        layout: createLayoutSource(() => remoteLayouts),
      }
    : coreWorkspaceSource(core));
// 창마다 하나인 대화 메모리. 공간을 오가도 작성 중 말이 남는다.
const conversation = { drafts: new DraftStore() };
// Agent 탭과 앱 공간의 Agent 칸이 agent마다 통로를 얻는 함수.
const agentViewSource =
  mock?.agentViewSource ??
  coreAgentTabSourceFactory(
    core,
    remote ? { device: true } : { signIn: signInInputRequest },
  );
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
// 창마다 하나. runtime의 대응과 살아 있는 xterm을 tab mount와 별도로 유지한다. 터미널 clipboard는 main이 쓴다.
// view는 처음 그릴 때 만들어지므로 그때는 `terminal`이 있다. 다른 기계의 창에는 터미널이 없다.
const terminal: TerminalDeps | undefined = remote
  ? undefined
  : windowTerminalDeps(new TerminalStore(), (host, edge) => {
      const bridge = terminal!.bridge;
      const clipboard: TerminalClipboard | null =
        bridge === null
          ? null
          : {
              copy: async (text) => {
                await bridge.copy({ text: text.slice(0, 60_000) });
              },
              paste: async () => {
                const reply = await bridge.paste();
                return reply.ok ? reply.value : "";
              },
            };
      return createXtermView(host, edge, undefined, clipboard);
    });

// 다른 기계의 job은 켜고 끄기만 한다(기기의 `jobs/update`는 `enabled`만 받는다). 고치기·지우기·가져오기가 없으면 그 단추가 없다.
function jobsSwitchOnly(core: CoreSource): JobsSource {
  const { list, runs, setEnabled } = coreJobsSource(core);
  return { list, runs, setEnabled };
}

function memoryQuickPrefs(): QuickPrefsSource {
  let prefs: QuickPrefs = DEFAULT_QUICK_PREFS;
  return {
    read: () => Promise.resolve({ ok: true, value: prefs }),
    write(key, value) {
      prefs = { ...prefs, [key]: value };
      return Promise.resolve({ ok: true, value: null });
    },
  };
}

// 창 안 팔레트. overlay와 shortcut 통로는 desktop preload가 연다.
const bridges = globalThis as {
  lophnShell?: OverlayApi &
    Partial<LophnShellViewsApi> &
    Partial<LophnShellAnnotateApi>;
  lophnShortcuts?: ShortcutApi;
  lophnIntents?: IntentApi;
  lophnBrowser?: LophnBrowserApi;
  lophnArtifact?: LophnArtifactApi;
  lophnDetached?: LophnDetachedApi;
};
const views: LophnShellViewsApi | undefined =
  mock?.views ??
  (typeof bridges.lophnShell?.openApp === "function"
    ? (bridges.lophnShell as LophnShellViewsApi)
    : undefined);
const annotate: LophnShellAnnotateApi | undefined =
  mock?.annotate ??
  (typeof bridges.lophnShell?.setMode === "function"
    ? (bridges.lophnShell as LophnShellAnnotateApi)
    : undefined);
const browser: LophnBrowserApi | null =
  mock?.browser ?? bridges.lophnBrowser ?? null;
const artifact: LophnArtifactApi | null = bridges.lophnArtifact ?? null;
const palette: PaletteDeps | undefined =
  bridges.lophnShell && bridges.lophnShortcuts
    ? {
        overlay: bridges.lophnShell,
        shortcuts: bridges.lophnShortcuts,
        search: fileSearch(catalog, coreFileSearchSource(core)),
      }
    : undefined;

// main이 묻는 전역 hook 설치 확인. desktop preload에만 있다.
const hookPrompt = (globalThis as { lophnCoding?: HookPromptApi }).lophnCoding;

// 앱 패널 탭과 세션 앱 카드의 view 통로. desktop 창 preload에만 있다. 화면 선언 read로
// 프로젝트 탭의 앱 패널 열기를 세운다.
const appViews: AppViewsDeps | null =
  mock?.appViews ??
  (views
    ? {
        views,
        app: coreAppRead(core),
        screens: coreAppScreens(core),
        enableRun: (app) => appDetail.setRun(app, true),
        icon: coreAppIcon(core),
      }
    : null);

// project 표식의 icon 읽기와 project 설정의 올리기. 앱 icon과 달리 project는 선언이 없고 올린 것만 있다.
const projectIcons = mock?.projectIcons ?? coreProjectIcons(core);

// 파일 읽기와 chat의 code block이 같은 Worker를 쓴다. Worker는 첫 highlight 때 뜬다.
const highlighter = createWorkerHighlighter();

const tree = (
  <div className={styles.root}>
    <HighlighterProvider value={highlighter}>
      <ProjectIconsProvider value={projectIcons}>
        <AppViewsProvider value={appViews}>
          <BrowserApiProvider value={browser}>
            <ArtifactApiProvider value={artifact}>
              <AnnotateApiProvider value={annotate}>
                <BrowserOverlayProvider value={bridges.lophnShell ?? null}>
                  <ConversationProvider deps={conversation}>
                    <EventsProvider client={events} terminals={terminal?.store}>
                      <QuickPrefsProvider source={quickPrefs}>
                        <RemoteGroupsProvider>
                          <Desktop
                            source={core}
                            initial={start}
                            workspace={workspace}
                            editor={bench ? bench.editor : editor}
                            windowWidth={seed ? 1440 : undefined}
                            terminal={terminal}
                            catalog={catalog}
                            palette={palette}
                            projects={projects}
                            intents={bridges.lophnIntents}
                            apps={apps}
                            settings={settings}
                            settingsPanels={settingsPanels}
                            jobs={jobs}
                            appDetail={appDetail}
                            views={views}
                            overlay={bridges.lophnShell}
                            hookPrompt={hookPrompt}
                            agentViewSource={agentViewSource}
                            detached={bridges.lophnDetached}
                          />
                        </RemoteGroupsProvider>
                      </QuickPrefsProvider>
                    </EventsProvider>
                  </ConversationProvider>
                </BrowserOverlayProvider>
              </AnnotateApiProvider>
            </ArtifactApiProvider>
          </BrowserApiProvider>
        </AppViewsProvider>
      </ProjectIconsProvider>
    </HighlighterProvider>
  </div>
);
mount(
  machines === null ? (
    tree
  ) : (
    <MachinesProvider source={machines}>{tree}</MachinesProvider>
  ),
);
