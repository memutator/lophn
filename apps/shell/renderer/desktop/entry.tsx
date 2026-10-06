import { mount } from "../entry.tsx";
import { Desktop } from "./main.tsx";
import { windowCoreSource } from "./connection/connection.ts";
import { devSeed } from "./dev-seed.ts";
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
import { coreContextsSource } from "./lophn-space/contexts/core-source.ts";
import { coreOrganizeSource } from "./lophn-space/organize/core-source.ts";
import { windowTerminalDeps } from "../terminal/deps.ts";
import { TerminalStore } from "../terminal/store.ts";
import { createXtermView } from "../terminal/xterm-view.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import {
  type AppViewsDeps,
  AppViewsProvider,
  coreAppRead,
} from "../app-frame/app-views.tsx";
import type { IntentApi, ShortcutApi } from "../../ipc/shortcuts.ts";
import type { PaletteDeps } from "./palette/host.tsx";
import { documentSearch } from "./palette/search.ts";
import { ConversationProvider } from "../conversation/dock-slot.tsx";
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
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { LophnAppWindowsApi } from "../../ipc/app-window.ts";
import type { LophnShellFeedbackBegin } from "../../ipc/feedback.ts";
// xterm 기본 배치. CSP 때문에 xterm이 넣는 <style>은 xterm-view가 옮긴다.
import "@xterm/xterm/css/xterm.css";
import styles from "./entry.module.css";

const seed = devSeed();
const core = windowCoreSource();
const editor = windowEditorDeps(core);
const lophn = coreLophnSource(core);
const contexts = coreContextsSource(core);
// projects 화면의 정리(이름·보관·문서 이동·export·파일로 두기와 빼기).
const organize = coreOrganizeSource(core);
// apps 화면과 앱 공간. 앱 view는 shell preload의 view 통로로 main이 붙인다.
const apps = coreAppsSource(core);
// 런처의 프로젝트 카드·등록과 작업대(추적 켜기 포함)는 제품 core 통로로 읽고 쓴다.
const projects = coreLauncherSource(core, windowFolderPicker());
const workspace = seed?.source ?? coreWorkspaceSource(core);
const tracking = seed ? undefined : coreTrackingSource(core);
// 창마다 하나인 대화 통로와 메모리. 공간을 오가도 작성 중 말이 남는다(desktop#R8).
const conversation = {
  source: coreConversationSource(core),
  drafts: new DraftStore(),
  startOpen: location.hash === "#conversation",
};
// 창마다 하나인 질문·approval 통로와 고르던 답. 도크의 칸·things-to-confirm·chip이 같이 쓴다.
const requests = {
  source: coreRequestSource(core),
  drafts: new RequestDrafts(),
};
// 개발 확인용 시작 자리. `#lophn`이면 lophn 공간(documents)부터, `#conversation`이면
// 거기에 대화 도크까지 열어 두고, `#things-to-confirm`이면 그 형제부터, `#project=<id>`면 그
// 프로젝트 작업대부터, `#app=<id>`면 그 앱 공간부터, `#apps`면 apps 형제부터 연다. `#contexts`면 contexts
// 형제부터, `#contexts=<id>`면 그 Focus까지 연다. `#instructions=global`·`#instructions=project:<id>`면
// 그 [Instructions] 편집기부터 연다. 기본은 런처다.
const start: Route | undefined = seed
  ? openProject(seed.project)
  : location.hash === "#lophn" || location.hash === "#conversation"
  ? openLophn()
  : location.hash === "#things-to-confirm"
  ? openLophn("things-to-confirm")
  : location.hash === "#contexts"
  ? openLophn("contexts")
  : location.hash.startsWith("#contexts=")
  ? {
    ...openLophn("contexts"),
    focus: location.hash.slice("#contexts=".length),
  }
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
const views: LophnShellViewsApi | undefined =
  typeof bridges.lophnShell?.openApp === "function"
    ? bridges.lophnShell as LophnShellViewsApi
    : undefined;
const feedback: LophnShellFeedbackBegin | undefined =
  typeof bridges.lophnShell?.beginFeedback === "function"
    ? bridges.lophnShell as LophnShellFeedbackBegin
    : undefined;
const palette: PaletteDeps | undefined =
  bridges.lophnShell && bridges.lophnShortcuts
    ? {
      overlay: bridges.lophnShell,
      shortcuts: bridges.lophnShortcuts,
      search: documentSearch(lophn),
    }
    : undefined;

// 앱 패널 탭과 세션 앱 카드의 view 통로. desktop 창 preload에만 있다. 화면 선언(blueprint) read와
// 문제 알리기는 아직 core 통로가 없어 두지 않는다.
const appViews: AppViewsDeps | null = views
  ? { views, app: coreAppRead(core) }
  : null;

mount(
  <div className={styles.root}>
    <AppViewsProvider value={appViews}>
      <ConversationProvider deps={conversation}>
        <RequestsProvider deps={requests}>
          <Desktop
            source={core}
            initial={start}
            workspace={workspace}
            editor={seed ? { ...seed.editor, menu: editor.menu } : editor}
            windowWidth={seed ? 1440 : undefined}
            terminal={terminal}
            lophn={lophn}
            contexts={contexts}
            organize={organize}
            palette={palette}
            projects={projects}
            tracking={tracking}
            intents={bridges.lophnIntents}
            apps={apps}
            views={views}
            appWindows={bridges.lophnAppWindows}
            feedback={feedback}
            instructions={windowInstructionsSource()}
          />
        </RequestsProvider>
      </ConversationProvider>
    </AppViewsProvider>
  </div>,
);
