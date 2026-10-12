import { type ReactNode, useState } from "react";

import type { CoreSource } from "./connection/connection.ts";
import { useConnection } from "./connection/connection.tsx";
import { Launcher } from "./launcher/launcher.tsx";
import {
  LAUNCHER,
  openApp,
  openInstructions,
  openLophn,
  openProject,
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
import { LophnSpace } from "./lophn-space/lophn-space.tsx";
import type { LophnSource } from "./lophn-space/source.ts";
import type { OrganizeSource } from "./lophn-space/organize/source.ts";
import { type PaletteDeps, PaletteProvider } from "./palette/host.tsx";
import { NotificationChip } from "./notification-chip/notification-chip.tsx";
import type { LauncherSource } from "./launcher/source.ts";
import type { TrackingSource } from "../workspace/tracking/source.ts";
import type { IntentApi } from "../../ipc/shortcuts.ts";
import { DesktopIntents } from "./intents.tsx";
import type { LophnTarget } from "./palette/lophn-scope.ts";
import { AppSpace } from "../app-frame/app-space.tsx";
import type { AppsSource } from "./lophn-space/apps/source.ts";
import type { SettingsSource } from "./lophn-space/settings/source.ts";
import type { SettingsPanels } from "./lophn-space/settings/settings-screen.tsx";
import type { CodingConnectionsSource } from "./lophn-space/settings/connections/source.ts";
import type { TasksSource } from "../app-frame/app-detail/tasks/source.ts";
import type { IssuesSource } from "../app-frame/app-detail/issues/source.ts";
import type { AppDetailSource } from "../app-frame/app-detail/source.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { LophnAppWindowsApi } from "../../ipc/app-window.ts";
import type { LophnShellFeedbackBegin } from "../../ipc/feedback.ts";

export interface DesktopProps {
  source: CoreSource;
  /** 창을 연 자리. 기본 창은 런처다. */
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
  /** lophn 공간(documents·series) 통로. 없으면 lophn 공간 대신 런처를 보인다. */
  lophn?: LophnSource;
  /** projects 화면의 정리 통로. 없으면 projects는 준비 전 안내다. */
  organize?: OrganizeSource;
  /** 창 안 팔레트와 shortcut 통로. 없으면 팔레트를 열지 않는다. */
  palette?: PaletteDeps;
  /** 런처의 프로젝트 카드·등록 통로. 없으면 카드 자리는 비었음 상태다. */
  projects?: LauncherSource;
  /** 작업대의 파일 추적 켜기 통로. */
  tracking?: TrackingSource;
  /** main이 시키는 것(전역 팔레트, OS notification 클릭). 없으면 받지 않는다. */
  intents?: IntentApi;
  /** [Instructions] 통로. 없으면 instructions 공간을 열지 않는다. */
  instructions?: InstructionsSource;
  /** apps 화면과 앱 공간의 통로. 없으면 앱 행은 apps 형제 화면으로만 간다. */
  apps?: AppsSource;
  /** settings 화면 통로. 없으면 settings는 준비 전 안내다. */
  settings?: SettingsSource;
  /** settings의 backup·update·진단·notification 탭 통로. 없는 탭은 두지 않는다. */
  settingsPanels?: SettingsPanels;
  /** 앱 공간 운영 패널의 app-detail 통로. 없으면 app-detail 탭을 두지 않는다. */
  appDetail?: AppDetailSource;
  /** shell preload의 앱 view 통로. 앱 공간 본문이 쓴다. */
  views?: LophnShellViewsApi;
  /** 앱 공간의 새 창 열기와 OS 앱 바로가기 통로. */
  appWindows?: LophnAppWindowsApi;
  /** [Report a problem] 통로. 앱 공간 바의 버튼이 쓴다. */
  feedback?: LophnShellFeedbackBegin;
  /** settings의 coding agent 연결 통로. 없으면 그 탭을 두지 않는다. */
  coding?: CodingConnectionsSource;
  /** 앱 공간 Tasks 탭 통로. 없으면 Tasks 탭은 아직 없다고 보인다. */
  tasks?: TasksSource;
  /** 앱 공간 Issues 탭 통로. 없으면 Issues 탭은 아직 없다고 보인다. */
  issues?: IssuesSource;
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
    lophn,
    organize,
    palette,
    projects,
    tracking,
    intents,
    instructions,
    apps,
    settings,
    settingsPanels,
    appDetail,
    views,
    appWindows,
    feedback,
    coding,
    tasks,
    issues,
  }: DesktopProps,
) {
  const [route, setRoute] = useState<Route>(initial);
  // things-to-confirm으로 간 횟수. 이미 lophn 공간이어도 그 형제를 다시 연다.
  const [visits, setVisits] = useState(0);
  const launcher = () => setRoute(LAUNCHER);
  const lophnSpace = () => setRoute(openLophn());
  // lophn 공간의 형제로 간다. 이미 lophn 공간이어도 그 자리를 다시 연다.
  const visit = (next: Route) => {
    setVisits((value) => value + 1);
    setRoute(next);
  };
  const thingsToConfirm = () => visit(openLophn("things-to-confirm"));
  // 앱 행은 그 앱 공간으로 간다. 앱 통로가 없는 창은 apps 형제 화면으로 간다.
  const appSpace = (app: string) =>
    apps ? setRoute(openApp(app)) : visit(openLophn("apps"));
  // 링크로 온 요청은 고르기만 한다. 결정 창은 사람이 그 화면에서 누를 때 연다(desktop#R14).
  const confirmTarget = (request?: string) =>
    request === undefined
      ? thingsToConfirm()
      : visit({ ...openLophn("things-to-confirm"), request });
  // 회수·취소·생성 링크(`cac_`·`tkt_`·`app_`). 그 대상의 화면만 열고 결정 창은 사람이 누를 때 연다.
  // Task 링크는 그 Task가 속한 앱 공간의 Tasks 탭으로 가고, 읽지 못하면 things-to-confirm으로 간다.
  const codingTarget = (target: string) => {
    if (target.startsWith("cac_")) {
      visit({ ...openLophn("settings"), connection: target });
    } else if (target.startsWith("app_")) {
      setVisits((value) => value + 1);
      setRoute({
        ...openApp(target),
        taskTarget: { ticket: null, create: true },
      });
    } else if (tasks) {
      void tasks.get(target).then((read) => {
        if (!read.ok) {
          thingsToConfirm();
          return;
        }
        setVisits((value) => value + 1);
        setRoute({
          ...openApp(read.value.app),
          taskTarget: { ticket: target, create: false },
        });
      });
    } else thingsToConfirm();
  };
  // 접수된 feedback이 묶인 Issue. 그 앱 공간을 Issues 탭으로, 그 문제를 고른 채 연다.
  const issueTarget = (app: string, problem: string) => {
    setVisits((value) => value + 1);
    setRoute({ ...openApp(app), issueProblem: problem });
  };
  // 전역 팔레트에서 고른 대상. lophn 공간 팔레트와 같은 목적지로만 간다(desktop#R30).
  const go = (target: LophnTarget) => {
    if (target.kind === "launcher") launcher();
    else if (target.kind === "project") setRoute(openProject(target.id));
    else if (target.kind === "screen") visit(openLophn(target.screen));
    else if (target.kind === "app") appSpace(target.id);
    else {
      visit(openLophn("documents", {
        document: target.document,
        version: target.version,
      }));
    }
  };
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
        onLophn={lophnSpace}
        onThingsToConfirm={thingsToConfirm}
        editor={editor}
        terminal={terminal}
        tracking={tracking}
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
          ? () => visit(openLophn("settings"))
          : launcher}
      />
    );
  } else if (route.space === "app" && route.app && apps && live) {
    space = (
      <AppSpace
        key={route.taskTarget || route.issueProblem
          ? `${route.app}:${visits}`
          : route.app}
        app={route.app}
        source={apps}
        views={views}
        windows={appWindows}
        feedback={feedback}
        detail={appDetail}
        tasks={tasks}
        taskTarget={route.taskTarget}
        issues={issues}
        issueProblem={route.issueProblem}
        onInstructions={instructions
          ? () =>
            setRoute(openInstructions({ layer: "app", place: route.app! }))
          : undefined}
        windowWidth={windowWidth}
        onLauncher={launcher}
        onDocuments={() => visit(openLophn("documents"))}
        onOpenResult={(document, version) =>
          visit(
            version === null
              ? openLophn("documents")
              : openLophn("documents", { document, version }),
          )}
        onThingsToConfirm={thingsToConfirm}
      />
    );
  } else if (route.space === "lophn" && lophn) {
    space = (
      <LophnSpace
        key={visits}
        source={lophn}
        organize={organize}
        screen={route.screen}
        initialRead={route.read}
        initialRequest={route.request}
        windowWidth={windowWidth}
        {...(editor?.files ? { sessions: editor.files } : {})}
        onLauncher={launcher}
        onProject={(project) => setRoute(openProject(project))}
        apps={apps}
        onApp={appSpace}
        settings={settings}
        settingsPanels={settingsPanels}
        coding={coding}
        initialConnection={route.connection}
        onInstructions={instructions
          ? () => setRoute(openInstructions({ layer: "global" }))
          : undefined}
      />
    );
  } else {
    space = (
      <Launcher
        source={source}
        formatTime={formatTime}
        onLophn={lophnSpace}
        projects={projects}
        onProject={(project) => setRoute(openProject(project))}
        apps={apps}
        onApp={appSpace}
      />
    );
  }
  // 창 shortcut의 런처 복귀와 팔레트는 어느 공간에서든 같은 자리에서 받는다(desktop#R18).
  return (
    <PaletteProvider deps={palette} onLauncher={launcher}>
      {space}
      <NotificationChip onView={thingsToConfirm} />
      {intents
        ? (
          <DesktopIntents
            intents={intents}
            lophn={lophn}
            onThingsToConfirm={confirmTarget}
            onCoding={codingTarget}
            onIssue={issueTarget}
            go={go}
          />
        )
        : null}
    </PaletteProvider>
  );
}
