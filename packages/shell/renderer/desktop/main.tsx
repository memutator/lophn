import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { CoreSource } from "./connection/connection.ts";
import { useConnection } from "./connection/connection.tsx";
import { useSessions } from "./connection/events/hooks.tsx";
import { ToastHost } from "./connection/toasts/toast-host.tsx";
import { registerToastActionHandler } from "./connection/toasts/toast-actions.ts";
import { useWaitingPanel } from "./connection/waiting/waiting-layer.tsx";
import { Launcher } from "./launcher/launcher.tsx";
import {
  LAUNCHER,
  openApp,
  openInstructions,
  openProject,
  openSettings,
  type Route,
} from "./router.ts";
import {
  InstructionsEntry,
  type InstructionsSource,
} from "../editor/instructions-entry.tsx";
import { Workspace } from "../workspace/workspace.tsx";
import type { WorkspaceSource } from "../workspace/source.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import type { TerminalDeps } from "../terminal/deps.ts";
import { SettingsSpace } from "./settings/settings-space.tsx";
import type { CatalogSource } from "./palette/catalog.ts";
import { type PaletteDeps, PaletteProvider } from "./palette/host.tsx";
import type { ProjectsSource } from "./launcher/projects/source.ts";
import type { IntentApi } from "../../ipc/shortcuts.ts";
import { DesktopIntents } from "./intents.tsx";
import type { DesktopTarget } from "./palette/desktop-scope.ts";
import { AppSpace } from "../app-frame/app-space.tsx";
import type { ProjectsRead } from "../app-frame/project-picker.tsx";
import type { AppsSource } from "../apps/source.ts";
import type { SettingsPane } from "./settings/model.ts";
import type { SettingsSource } from "./settings/source.ts";
import type { SettingsPanels } from "./settings/settings-screen.tsx";
import { applyTheme } from "./settings/appearance/model.ts";
import type { IssuesSource } from "../app-frame/app-detail/issues/source.ts";
import type { AppDetailSource } from "../app-frame/app-detail/source.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { LophnShellAnnotateApi } from "../../ipc/annotation.ts";
import type { LophnShellFeedbackBegin } from "../../ipc/feedback.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";

interface DesktopProps {
  source: CoreSource;
  /** 창이 처음 여는 화면. 기본 창은 런처다. */
  initial?: Route;
  formatTime?: (confirmedAt: number) => string;
  /** 프로젝트 작업대 통로. project 공간에서만 쓴다. */
  workspace?: WorkspaceSource;
  /** 창 폭. 테스트가 고정한다. */
  windowWidth?: number;
  /** 문서 탭의 읽기·편집 통로. */
  editor?: EditorDeps;
  /** 터미널 탭 통로. 창 preload가 열어 둔 통로로 entry가 만든다. */
  terminal?: TerminalDeps;
  /** 팔레트의 project·앱 행 통로. 없으면 Settings 대신 런처를 보인다. */
  catalog?: CatalogSource;
  /** 창 안 팔레트와 shortcut 통로. 없으면 팔레트를 열지 않는다. */
  palette?: PaletteDeps;
  /** main이 시키는 것(전역 팔레트). 없으면 받지 않는다. */
  intents?: IntentApi;
  /** [Instructions] 통로. 없으면 instructions 공간을 열지 않는다. */
  instructions?: InstructionsSource;
  /** 런처의 프로젝트 카드·등록·보관·detail 통로. 앱 공간의 project 고르기도 이 목록을 쓴다. 없으면 카드는 비었음 상태다. */
  projects?: ProjectsSource;
  /** 런처의 앱 카드·보관과 앱 공간의 통로. 없으면 앱 공간을 열지 않는다. */
  apps?: AppsSource;
  /** settings 공간 통로. 없으면 settings는 준비 전 안내다. */
  settings?: SettingsSource;
  /** settings 항목마다의 통로. 없는 항목은 준비 전 안내다. */
  settingsPanels?: SettingsPanels;
  /** 앱 공간 운영 패널의 app-detail 통로. 없으면 app-detail 탭을 두지 않는다. */
  appDetail?: AppDetailSource;
  /** shell preload의 앱 view 통로. 앱 공간 본문이 쓴다. */
  views?: LophnShellViewsApi;
  /** shell preload의 Annotate 통로. 없으면 Annotate 단추를 두지 않는다. */
  annotate?: LophnShellAnnotateApi;
  /** [Report a problem] 통로. 앱 공간 바의 버튼이 쓴다. */
  feedback?: LophnShellFeedbackBegin;
  /** 앱 공간 Issues 탭 통로. 없으면 Issues 탭은 아직 없다고 보인다. */
  issues?: IssuesSource;
  /** Agent 화면이 agent 하나의 통로를 얻는 함수. 앱 공간의 agent 칸이 쓴다. 없으면 칸은 준비 안 됨이다. */
  agentViewSource?: AgentTabSourceFactory;
  /** 창 위 overlay. toast를 띄운다. 없으면 toast를 띄우지 않는다. */
  overlay?: OverlayApi;
}

// toast 행동의 기본 처리. 지금 보이는 화면이 처리하지 못한 행동(그 화면이 false를 돌렸다)을 다른 화면으로 가서
// 연다. 화면의 처리기보다 먼저 등록돼야(목록에서 뒤에 서야) 화면이 먼저 처리하니, 화면보다 앞에 그린다.
function DefaultToastHandler(
  { openSession, goProject, goApp }: {
    openSession: (session: string) => void;
    goProject: (route: Route) => void;
    goApp: (app: string) => void;
  },
) {
  const { setOpen } = useWaitingPanel();
  const latest = useRef({ openSession, goProject, goApp });
  latest.current = { openSession, goProject, goApp };
  useEffect(() =>
    registerToastActionHandler((action) => {
      const current = latest.current;
      switch (action.kind) {
        case "waiting":
          setOpen(true);
          return true;
        case "session":
          if (action.session !== null) {
            current.openSession(action.session);
            return true;
          }
          // 앱의 App Engineer session은 아직 없다. 그 앱 공간으로 간다.
          if (action.app === undefined) return false;
          current.goApp(action.app);
          return true;
        case "project-manager":
          current.goProject(openProject(action.project, {
            projectManager: { context: action.context, check: action.check },
          }));
          return true;
      }
    }), [setOpen]);
  return null;
}

// 새 기본 창의 첫 화면. 공간 이동은 이 상태가 기억한다.
export function Desktop(
  {
    source,
    initial = LAUNCHER,
    formatTime,
    workspace,
    windowWidth = 1280,
    editor,
    terminal,
    catalog,
    palette,
    projects,
    intents,
    instructions,
    apps,
    settings,
    settingsPanels,
    appDetail,
    views,
    annotate,
    feedback,
    issues,
    agentViewSource,
    overlay,
  }: DesktopProps,
) {
  const [route, setRoute] = useState<Route>(initial);
  // 같은 화면이어도 다시 열게 하는 횟수. Settings는 열 때 처음 상태로 선다.
  const [visits, setVisits] = useState(0);
  const launcher = () => setRoute(LAUNCHER);
  // Settings로 간다. 이미 Settings여도 고른 항목부터 다시 연다.
  const settingsSpace = (pane?: SettingsPane) => {
    setVisits((value) => value + 1);
    setRoute(openSettings(pane));
  };
  const appSpace = (app: string) => setRoute(openApp(app));
  // 접수된 feedback이 묶인 Issue. 그 앱 공간을 Issues 탭으로, 그 문제를 고른 채 연다.
  const issueTarget = (app: string, problem: string) => {
    setVisits((value) => value + 1);
    setRoute({ ...openApp(app), issueProblem: problem });
  };
  // 전역 팔레트에서 고른 대상. Workspace 팔레트와 같은 목적지로만 간다.
  const go = (target: DesktopTarget) => {
    if (target.kind === "launcher") launcher();
    else if (target.kind === "project") setRoute(openProject(target.id));
    else if (target.kind === "settings") settingsSpace();
    else if (target.kind === "app") appSpace(target.id);
    else setRoute(openProject(target.project, { open: target.file }));
  };

  // session을 그 session이 있는 창에서 연다. project의 session은 그 project 창, 앱의 session은 그 앱 공간이다.
  // place가 없는 lophn의 session은 마지막으로 연 project 창에서 연다. project를 연 적이 없으면 런처로 간다.
  const { sessions } = useSessions();
  const lastProject = useRef<string | null>(null);
  useEffect(() => {
    if (route.space === "project" && route.project) {
      lastProject.current = route.project;
    }
  }, [route]);
  const known = useRef(sessions);
  known.current = sessions;
  const openSession = (session: string) => {
    const place = known.current.find((entry) => entry.session === session)
      ?.place;
    if (place?.kind === "project") {
      setRoute(openProject(place.id, { session }));
    } else if (place?.kind === "app") setRoute(openApp(place.id, session));
    else if (lastProject.current !== null) {
      setRoute(openProject(lastProject.current, { session }));
    } else launcher();
  };
  // coding agent 카드의 [Answer in terminal]. 그 session의 탭이 이 창에도 main에도 없으면 그 session의 창으로 간 뒤 다시 고른다.
  const [focusRequest, setFocusRequest] = useState<{ session: string } | null>(
    null,
  );
  useEffect(() => {
    if (focusRequest !== null) {
      void terminal?.store.focusSession(focusRequest.session);
    }
  }, [focusRequest]);
  const answerInTerminal = (session: string) => {
    void (async () => {
      if (
        terminal !== undefined && await terminal.store.focusSession(session)
      ) {
        return;
      }
      openSession(session);
      setFocusRequest({ session });
    })();
  };

  // 앱 공간의 project 고르기 목록. 런처와 같은 통로로 읽는다.
  const projectsRead = useMemo<ProjectsRead | undefined>(
    () =>
      projects === undefined ? undefined : async () => {
        const read = await projects.list();
        return read.ok
          ? {
            ok: true,
            value: read.value.filter((row) => !row.archived).map((row) => ({
              id: row.id,
              name: row.title,
              folder: row.folders[0]?.path ?? "",
            })),
          }
          : { ok: false };
      },
    [projects],
  );

  // 저장한 theme을 시작할 때 적용한다. core가 준비되면 읽는다.
  const appearance = settingsPanels?.appearance;
  useEffect(() => {
    if (appearance === undefined) return;
    return appearance.watch((state) => {
      if (state.state !== "ready") return;
      void appearance.values().then((read) => {
        if (read.ok) applyTheme(read.value.theme);
      });
    });
  }, [appearance]);

  // modal(dialog·palette)이 뜨면 scrim이 상단 바도 덮고 바는 끌기에서 빠진다. 스타일은 top-bar.module.css다.
  useEffect(() => {
    if (!overlay) return;
    const root = document.documentElement;
    const off = overlay.subscribe((event) => {
      if ("type" in event && event.type === "modal") {
        if (event.open) root.dataset.overlayModal = "";
        else delete root.dataset.overlayModal;
      }
    }, () => {});
    return () => {
      off();
      delete root.dataset.overlayModal;
    };
  }, [overlay]);

  // 작업대는 core 기록을 읽어 연다. 준비 전·실패에는 런처의 연결 화면을 보이고, 준비되면 그때
  // 작업대를 열어 읽는다.
  const connection = useConnection(source);
  const live = connection.state === "ready" || connection.state === "stale";
  let space: ReactNode;
  if (route.space === "project" && route.project && workspace && live) {
    space = (
      <Workspace
        projectId={route.project}
        source={workspace}
        windowWidth={windowWidth}
        bodyWidth={windowWidth - 240}
        onLauncher={launcher}
        onSettings={settingsSpace}
        onProjectInstructions={instructions
          ? () =>
            setRoute(openInstructions({
              layer: "project",
              place: route.project!,
            }))
          : undefined}
        onOpenApp={apps ? appSpace : undefined}
        editor={editor}
        terminal={terminal}
        agentViewSource={agentViewSource}
        session={route.session}
        projectManager={route.projectManager}
        open={route.open}
      />
    );
  } else if (
    route.space === "instructions" && route.instructions && instructions &&
    editor && live
  ) {
    space = (
      <InstructionsEntry
        place={route.instructions}
        source={instructions}
        editor={editor}
        // 전역 지침은 settings에서 왔으니 settings로 돌아간다.
        onBack={route.instructions.layer === "global"
          ? () => settingsSpace()
          : launcher}
      />
    );
  } else if (route.space === "app" && route.app && apps && live) {
    space = (
      <AppSpace
        key={route.issueProblem ? `${route.app}:${visits}` : route.app}
        app={route.app}
        source={apps}
        views={views}
        feedback={feedback}
        detail={appDetail}
        issues={issues}
        issueProblem={route.issueProblem}
        agents={workspace?.agentsSource}
        agentViewSource={agentViewSource}
        onSettings={settingsSpace}
        onInstructions={instructions
          ? () =>
            setRoute(openInstructions({ layer: "app", place: route.app! }))
          : undefined}
        windowWidth={windowWidth}
        onLauncher={launcher}
        annotate={annotate}
        projects={projectsRead}
        overlay={overlay}
        terminal={terminal}
        session={route.session}
        onOpenSession={openSession}
      />
    );
  } else if (route.space === "settings" && catalog) {
    space = (
      <SettingsSpace
        key={visits}
        source={catalog}
        settingsPane={route.settingsPane}
        windowWidth={windowWidth}
        onLauncher={launcher}
        onProject={(project) => setRoute(openProject(project))}
        onOpenFile={(project, file) =>
          setRoute(openProject(project, { open: file }))}
        onApp={appSpace}
        settings={settings}
        settingsPanels={settingsPanels}
        onInstructions={instructions
          ? () => setRoute(openInstructions({ layer: "global" }))
          : undefined}
        onOpenSession={openSession}
        onAnswerInTerminal={answerInTerminal}
      />
    );
  } else {
    space = (
      <Launcher
        source={source}
        formatTime={formatTime}
        onSettings={settingsSpace}
        projects={projects}
        onProject={(project) => setRoute(openProject(project))}
        apps={apps}
        onApp={appSpace}
        onOpenSession={openSession}
        onAnswerInTerminal={answerInTerminal}
      />
    );
  }
  // 창 shortcut의 런처 복귀와 팔레트는 어느 공간에서든 이 한 곳에서 받는다.
  return (
    <PaletteProvider deps={palette} onLauncher={launcher}>
      <DefaultToastHandler
        openSession={openSession}
        goProject={setRoute}
        goApp={(app) => setRoute(openApp(app))}
      />
      {space}
      {overlay ? <ToastHost overlay={overlay} /> : null}
      {intents
        ? (
          <DesktopIntents
            intents={intents}
            catalog={catalog}
            onIssue={issueTarget}
            go={go}
          />
        )
        : null}
    </PaletteProvider>
  );
}
