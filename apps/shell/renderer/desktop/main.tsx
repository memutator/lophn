import { type ReactNode, useState } from "react";

import type { CoreSource } from "./connection/connection.ts";
import { Launcher } from "./launcher/launcher.tsx";
import { LAUNCHER, openLophn, openProject, type Route } from "./router.ts";
import { Workspace } from "../workspace/workspace.tsx";
import type { WorkspaceSource } from "../workspace/source.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import type { TerminalDeps } from "../terminal/deps.ts";
import { LophnSpace } from "./lophn-space/lophn-space.tsx";
import type { LophnSource } from "./lophn-space/source.ts";
import { type PaletteDeps, PaletteProvider } from "./palette/host.tsx";
import { NotificationChip } from "./notification-chip/notification-chip.tsx";
import type { LauncherSource } from "./launcher/source.ts";
import type { TrackingSource } from "../workspace/tracking/source.ts";

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
  /** 창 안 팔레트와 shortcut 통로. 없으면 팔레트를 열지 않는다. */
  palette?: PaletteDeps;
  /** 런처의 프로젝트 카드·등록 통로. 없으면 카드 자리는 비었음 상태다. */
  projects?: LauncherSource;
  /** 작업대의 파일 추적 켜기 통로. */
  tracking?: TrackingSource;
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
    palette,
    projects,
    tracking,
  }: DesktopProps,
) {
  const [route, setRoute] = useState<Route>(initial);
  // things-to-confirm으로 간 횟수. 이미 lophn 공간이어도 그 형제를 다시 연다.
  const [visits, setVisits] = useState(0);
  const launcher = () => setRoute(LAUNCHER);
  const lophnSpace = () => setRoute(openLophn());
  const thingsToConfirm = () => {
    setVisits((value) => value + 1);
    setRoute(openLophn("things-to-confirm"));
  };
  let space: ReactNode;
  if (route.space === "project" && route.project && workspace) {
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
  } else if (route.space === "lophn" && lophn) {
    space = (
      <LophnSpace
        key={visits}
        source={lophn}
        screen={route.screen}
        windowWidth={windowWidth}
        onLauncher={launcher}
        onProject={(project) => setRoute(openProject(project))}
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
      />
    );
  }
  // 창 shortcut의 런처 복귀와 팔레트는 어느 공간에서든 같은 자리에서 받는다(desktop#R18).
  return (
    <PaletteProvider deps={palette} onLauncher={launcher}>
      {space}
      <NotificationChip onView={thingsToConfirm} />
    </PaletteProvider>
  );
}
