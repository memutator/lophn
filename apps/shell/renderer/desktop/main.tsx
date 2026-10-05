import { useState } from "react";

import type { CoreSource } from "./connection/connection.ts";
import { Launcher } from "./launcher/launcher.tsx";
import { LAUNCHER, openLophn, type Route } from "./router.ts";
import { Workspace } from "../workspace/workspace.tsx";
import type { WorkspaceSource } from "../workspace/source.ts";
import type { EditorDeps } from "../editor/document-view.tsx";

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
  }: DesktopProps,
) {
  const [route, setRoute] = useState<Route>(initial);
  if (route.space === "project" && route.project && workspace) {
    return (
      <Workspace
        projectId={route.project}
        source={workspace}
        windowWidth={windowWidth}
        bodyWidth={windowWidth - 240}
        onLauncher={() => setRoute(LAUNCHER)}
        onLophn={() => setRoute(openLophn())}
        editor={editor}
      />
    );
  }
  if (route.space === "launcher") {
    return (
      <Launcher
        source={source}
        formatTime={formatTime}
        onLophn={() => setRoute(openLophn())}
      />
    );
  }
  return (
    <Launcher
      source={source}
      formatTime={formatTime}
      onLophn={() => setRoute(openLophn())}
    />
  );
}
