import { mount } from "../entry.tsx";
import { HighlighterProvider } from "@lophn/ui/reading";
import { createWorkerHighlighter } from "../highlight/client.ts";
import { Desktop } from "./main.tsx";
import { windowCoreSource } from "./connection/connection.ts";
import { devSeed } from "./dev-seed.ts";
import { devMock } from "./dev-mock/mod.ts";
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
import { windowTerminalDeps } from "../terminal/deps.ts";
import { TerminalStore } from "../terminal/store.ts";
import {
  createXtermView,
  type TerminalClipboard,
} from "../terminal/xterm-view.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import {
  type AppViewsDeps,
  AppViewsProvider,
  coreAppRead,
  coreAppScreens,
} from "../app-frame/app-views.tsx";
import type { IntentApi, ShortcutApi } from "../../ipc/shortcuts.ts";
import type { PaletteDeps } from "./palette/host.tsx";
import { fileSearch } from "./palette/search.ts";
import { coreFileSearchSource } from "../workspace/search/core-source.ts";
import { createEventClient } from "./connection/events/client.ts";
import { EventsProvider } from "./connection/events/hooks.tsx";
import { ConversationProvider } from "../conversation/window-deps.tsx";
import { coreAgentTabSourceFactory } from "../conversation/agent-tab-core-source.ts";
import { DraftStore } from "../conversation/drafts.ts";
import { coreWorkspaceSource } from "../workspace/core-source.ts";
import { coreAppsSource } from "../apps/core-source.ts";
import {
  coreProjectsSource,
  windowFolderPicker,
} from "./launcher/projects/core-source.ts";
import { coreSettingsSource } from "./settings/core-source.ts";
import { coreAppearanceSource } from "./settings/appearance/core-source.ts";
import { coreKeyboardSource } from "./settings/keyboard/core-source.ts";
import { coreJobsSource } from "./settings/jobs/core-source.ts";
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
// xterm 기본 배치. CSP 때문에 xterm이 넣는 <style>은 xterm-view가 옮긴다.
import "@xterm/xterm/css/xterm.css";
import styles from "./entry.module.css";

// 개발 확인 전용. 주소의 `mock`이면 core 대신 메모리 가짜 통로로 모든 화면을 채운다.
const mock = devMock();
const seed = mock ? null : devSeed();
// 시드 작업대와 mock 모드는 둘 다 가짜 작업대와 문서 탭 통로를 쓴다(core·편집 파일 통로 없음).
const bench = mock ? { source: mock.workspace, editor: mock.editor } : seed;
const core = mock?.core ?? windowCoreSource();
const editor = windowEditorDeps(core);
// 창마다 하나인 event 연결. 대기 목록·session 상태·toast가 이 연결 하나를 나눠 쓴다.
const events = createEventClient(mock?.events ?? core);
// 런처의 프로젝트 카드·등록·보관과 앱 공간의 project 고르기.
const projects =
  mock?.projects ?? coreProjectsSource(core, windowFolderPicker());
// 런처의 앱 카드·보관과 앱 공간. 앱 view는 shell preload의 view 통로로 main이 붙인다.
const apps = mock?.apps ?? coreAppsSource(core);
// 팔레트의 project·앱 행.
const catalog = mock?.catalog ?? catalogSource(projects, apps);
const appDetail = mock?.appDetail ?? coreAppDetailSource(core);
// settings 화면의 일반 설정·확장. credential은 보호 창이 받는다.
const settings = mock?.settings ?? coreSettingsSource(core);
// settings 항목마다의 통로. key·로그인 응답은 보호 창이 받고, coding agent 감지는 main이 따로 검증하는 통로(`lophnCoding`)다.
const settingsPanels = mock?.settingsPanels ?? {
  providers: coreProviderSettingsSource(core),
  agents: coreAgentsSettingsSource(core),
  diagnostics: coreDiagnosticsSource(core),
  shellRules: coreShellRulesSource(core),
  jobs: coreJobsSource(core),
  appearance: coreAppearanceSource(core),
  keyboard: coreKeyboardSource(core),
  coding: coreCodingConnectionsSource({ core, coding: windowCodingApi() }),
  browser: windowBrowserSettings(),
};
// 작업대는 제품 core 통로로 읽고 쓴다.
const workspace = bench?.source ?? coreWorkspaceSource(core);
// 창마다 하나인 대화 메모리. 공간을 오가도 작성 중 말이 남는다.
const conversation = { drafts: new DraftStore() };
// Agent 탭과 앱 공간의 Agent 칸이 agent마다 통로를 얻는 함수.
const agentViewSource =
  mock?.agentViewSource ?? coreAgentTabSourceFactory(core);
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
// `#detached=<탭 key>`는 main이 띄우는 detached 창이다. 기본은 런처다.
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
// view는 처음 그릴 때 만들어지므로 그때는 `terminal`이 있다.
const terminal = windowTerminalDeps(new TerminalStore(), (host, edge) => {
  const bridge = terminal.bridge;
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
    ? { views, app: coreAppRead(core), screens: coreAppScreens(core) }
    : null);

// 파일 읽기와 chat의 code block이 같은 Worker를 쓴다. Worker는 첫 highlight 때 뜬다.
const highlighter = createWorkerHighlighter();

mount(
  <div className={styles.root}>
    <HighlighterProvider value={highlighter}>
      <AppViewsProvider value={appViews}>
        <BrowserApiProvider value={browser}>
          <ArtifactApiProvider value={artifact}>
            <AnnotateApiProvider value={annotate}>
              <BrowserOverlayProvider value={bridges.lophnShell ?? null}>
                <ConversationProvider deps={conversation}>
                  <EventsProvider client={events}>
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
                      appDetail={appDetail}
                      views={views}
                      annotate={annotate}
                      overlay={bridges.lophnShell}
                      hookPrompt={hookPrompt}
                      agentViewSource={agentViewSource}
                      detached={bridges.lophnDetached}
                    />
                  </EventsProvider>
                </ConversationProvider>
              </BrowserOverlayProvider>
            </AnnotateApiProvider>
          </ArtifactApiProvider>
        </BrowserApiProvider>
      </AppViewsProvider>
    </HighlighterProvider>
  </div>,
);
