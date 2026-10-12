import { mount } from "../entry.tsx";
import { Desktop } from "./main.tsx";
import { windowCoreSource } from "./connection/connection.ts";
import { devSeed } from "./dev-seed.ts";
import { devMock } from "./dev-mock/mod.ts";
import { windowEditorDeps } from "../editor/window-deps.ts";
import { windowInstructionsSource } from "../editor/instructions-entry.tsx";
import {
  openApp,
  openInstructions,
  openLophn,
  openProject,
  type Route,
} from "./router.ts";
import { coreLophnSource } from "./lophn-space/core-source.ts";
import { coreOrganizeSource } from "./lophn-space/organize/core-source.ts";
import { windowTerminalDeps } from "../terminal/deps.ts";
import { TerminalStore } from "../terminal/store.ts";
import { createXtermView } from "../terminal/xterm-view.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import {
  type AppViewsDeps,
  AppViewsProvider,
  coreAppRead,
  coreAppScreens,
} from "../app-frame/app-views.tsx";
import type { IntentApi, ShortcutApi } from "../../ipc/shortcuts.ts";
import type { PaletteDeps } from "./palette/host.tsx";
import { documentSearch } from "./palette/search.ts";
import { ConversationProvider } from "../conversation/dock-slot.tsx";
import { coreAgentViewSourceFactory } from "../conversation/agent-core-source.ts";
import { coreConversationSource } from "../conversation/core-source.ts";
import { DraftStore } from "../conversation/drafts.ts";
import {
  RequestDrafts,
  RequestsProvider,
} from "./lophn-space/things-to-confirm/context.tsx";
import { coreRequestSource } from "./lophn-space/things-to-confirm/core-source.ts";
import {
  coreLauncherSource,
  windowFolderPicker,
} from "./launcher/core-source.ts";
import { coreWorkspaceSource } from "../workspace/core-source.ts";
import { coreTrackingSource } from "../workspace/tracking/core-source.ts";
import { coreAppsSource } from "./lophn-space/apps/core-source.ts";
import { coreSettingsSource } from "./lophn-space/settings/core-source.ts";
import { coreProviderSettingsSource } from "./lophn-space/settings/providers/core-source.ts";
import { coreAgentsSettingsSource } from "./lophn-space/settings/agents/core-source.ts";
import { coreBackupSource } from "./lophn-space/settings/backup/core-source.ts";
import { coreNotificationsSource } from "./lophn-space/settings/notifications/core-source.ts";
import { coreUpdateSource } from "./lophn-space/settings/update/core-source.ts";
import { coreDiagnosticsSource } from "./lophn-space/settings/diagnostics/core-source.ts";
import { coreAppDetailSource } from "../app-frame/app-detail/core-source.ts";
import {
  coreCodingConnectionsSource,
  windowCodingApi,
  windowRevokeOpener,
} from "./lophn-space/settings/connections/core-source.ts";
import { coreTasksSource } from "../app-frame/app-detail/tasks/core-source.ts";
import {
  coreIssuesSource,
  windowIssueDecision,
} from "../app-frame/app-detail/issues/core-source.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { LophnAppWindowsApi } from "../../ipc/app-window.ts";
import type { LophnShellFeedbackBegin } from "../../ipc/feedback.ts";
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
const lophn = mock?.lophn ?? coreLophnSource(core);
// projects 화면의 정리(이름·보관·문서 이동·export·파일로 두기와 빼기).
const organize = mock?.organize ?? coreOrganizeSource(core);
// apps 화면과 앱 공간. 앱 view는 shell preload의 view 통로로 main이 붙인다.
const apps = mock?.apps ?? coreAppsSource(core);
const appDetail = mock?.appDetail ?? coreAppDetailSource(core);
// settings 화면의 일반 설정·확장. credential은 보호 창이 받는다.
const settings = mock?.settings ?? coreSettingsSource(core);
// settings의 Providers(계정과 인증)·Agents(모든 project의 기본값) 자리와 운영 탭(shell#T58).
// key·로그인 응답은 보호 창이 받는다. backup 복원 계획·제출은 main의 복원 통로(`lophnRestore`)다.
// update는 사람이 고른 로컬 파일의 안내와 정상 정지다(`lophnUpdate`). 다운로드·재시작은 없다.
// OS notification은 이 탭에서 켠 뒤에만 shell main이 올린다(platform/notifications#R9).
const settingsPanels = mock?.settingsPanels ?? {
  providers: coreProviderSettingsSource(core),
  agents: coreAgentsSettingsSource(core),
  backup: coreBackupSource(core),
  update: coreUpdateSource(core),
  notifications: coreNotificationsSource(core),
  diagnostics: coreDiagnosticsSource(core),
};
// coding agent 연결(settings)과 앱 공간 Tasks 탭. 감지·연결·[Start]는 main이 따로 검증하는 통로(`lophnCoding`)다.
const codingApi = mock ? undefined : windowCodingApi();
const coding = mock?.coding ?? coreCodingConnectionsSource(core, {
  coding: codingApi,
  openWindow: windowRevokeOpener(),
});
const tasks = mock?.tasks ?? coreTasksSource(core, { coding: codingApi });
const issues = mock?.issues ?? coreIssuesSource(core, windowIssueDecision());
// 런처의 프로젝트 카드·등록과 작업대(추적 켜기 포함)는 제품 core 통로로 읽고 쓴다.
const projects = mock?.launcher ??
  coreLauncherSource(core, windowFolderPicker());
const workspace = bench?.source ?? coreWorkspaceSource(core);
const tracking = bench ? undefined : coreTrackingSource(core);
// 창마다 하나인 대화 통로와 메모리. 공간을 오가도 작성 중 말이 남는다(desktop#R8).
// 도크의 provider 끊김 줄(desktop#R7)은 같은 core 통로에서 계정 상태를 읽고, 행동은
// lophn 공간 settings로 간다.
const conversation = {
  source: mock?.conversation ?? coreConversationSource(core),
  drafts: new DraftStore(),
  startOpen: location.hash === "#conversation",
  core,
  onSettings: () => {
    location.hash = "#settings";
  },
};
// Agent 탭과 앱 공간의 Agent 칸이 agent마다 통로를 얻는 함수.
const agentViewSource = mock?.agentViewSource ??
  coreAgentViewSourceFactory(core);
// 창마다 하나인 질문·approval 통로와 고르던 답. 도크의 칸·things-to-confirm·chip이 같이 쓴다.
const requests = {
  source: mock?.requests ?? coreRequestSource(core),
  drafts: new RequestDrafts(),
};
// 개발 확인용 시작 자리. `#settings`면 settings 형제부터 연다. `#lophn`이면 lophn 공간(documents)부터, `#conversation`이면
// 거기에 대화 도크까지 열어 두고, `#things-to-confirm`이면 그 형제부터, `#project=<id>`면 그
// 프로젝트 작업대부터, `#app=<id>`면 그 앱 공간부터, `#apps`면 apps 형제부터 연다.
// `#instructions=global`·`#instructions=project:<id>`면
// 그 [Instructions] 편집기부터 연다. 기본은 런처다.
const start: Route | undefined = seed
  ? openProject(seed.project)
  : location.hash === "#lophn" || location.hash === "#conversation"
  ? openLophn()
  : location.hash === "#things-to-confirm"
  ? openLophn("things-to-confirm")
  : location.hash === "#projects"
  ? openLophn("projects")
  : location.hash.startsWith("#project=")
  ? openProject(location.hash.slice("#project=".length))
  : location.hash === "#instructions=global"
  ? openInstructions({ layer: "global" })
  : location.hash.startsWith("#instructions=project:")
  ? openInstructions({
    layer: "project",
    place: location.hash.slice("#instructions=project:".length),
  })
  : location.hash.startsWith("#app=")
  ? openApp(location.hash.slice("#app=".length))
  : location.hash === "#apps"
  ? openLophn("apps")
  : location.hash === "#settings"
  ? openLophn("settings")
  : undefined;
// 창마다 하나. 탭과 host runtime의 대응만 갖고 출력은 갖지 않는다.
const terminal = windowTerminalDeps(
  new TerminalStore(),
  (host) => createXtermView(host),
);

// 창 안 팔레트. overlay와 shortcut 통로는 desktop preload가 연다.
const bridges = globalThis as {
  lophnShell?:
    & OverlayApi
    & Partial<LophnShellViewsApi>
    & Partial<LophnShellFeedbackBegin>;
  lophnShortcuts?: ShortcutApi;
  lophnIntents?: IntentApi;
  lophnAppWindows?: LophnAppWindowsApi;
};
const views: LophnShellViewsApi | undefined = mock?.views ??
  (typeof bridges.lophnShell?.openApp === "function"
    ? bridges.lophnShell as LophnShellViewsApi
    : undefined);
const feedback: LophnShellFeedbackBegin | undefined = mock?.feedback ??
  (typeof bridges.lophnShell?.beginFeedback === "function"
    ? bridges.lophnShell as LophnShellFeedbackBegin
    : undefined);
const palette: PaletteDeps | undefined =
  bridges.lophnShell && bridges.lophnShortcuts
    ? {
      overlay: bridges.lophnShell,
      shortcuts: bridges.lophnShortcuts,
      search: documentSearch(lophn),
    }
    : undefined;

// 앱 패널 탭과 세션 앱 카드의 view 통로. desktop 창 preload에만 있다. 화면 선언(blueprint) read로
// 프로젝트 탭의 앱 패널 열기를 세우고, 문제 알리기는 아직 core 통로가 없어 두지 않는다.
const appViews: AppViewsDeps | null = mock?.appViews ??
  (views
    ? { views, app: coreAppRead(core), screens: coreAppScreens(core) }
    : null);

mount(
  <div className={styles.root}>
    <AppViewsProvider value={appViews}>
      <ConversationProvider deps={conversation}>
        <RequestsProvider deps={requests}>
          <Desktop
            source={core}
            initial={start}
            workspace={workspace}
            editor={bench ? { ...bench.editor, menu: editor.menu } : editor}
            windowWidth={seed ? 1440 : undefined}
            terminal={terminal}
            lophn={lophn}
            organize={organize}
            palette={palette}
            projects={projects}
            tracking={tracking}
            intents={bridges.lophnIntents}
            apps={apps}
            settings={settings}
            settingsPanels={settingsPanels}
            coding={coding}
            tasks={tasks}
            issues={issues}
            appDetail={appDetail}
            views={views}
            appWindows={mock?.appWindows ?? bridges.lophnAppWindows}
            feedback={feedback}
            instructions={mock?.instructions ?? windowInstructionsSource()}
            agentViewSource={agentViewSource}
          />
        </RequestsProvider>
      </ConversationProvider>
    </AppViewsProvider>
  </div>,
);
