import type { WorkspaceRef } from "../shell/desk-model.ts";
import type { SettingsPane } from "./settings/model.ts";

// 창 안의 자리. 새 기본 창은 언제나 Home에서 시작한다.
type Space =
  | "home"
  | "settings"
  | "project"
  | "app"
  | "app-window"
  | "detached";

/** 새 session의 시작: command는 coding agent 터미널, agent는 그 lophn agent, 둘 다 없으면 기본 lophn이다. */
export interface NewSessionStart {
  readonly agent?: string;
  readonly command?: string;
}

export interface Route {
  readonly space: Space;
  /** home·project·app 공간의 workspace가 다른 기계의 것이면 그 기계(`mch_`). 없으면 이 컴퓨터다. */
  readonly machine?: string;
  /** project 공간의 프로젝트 id. 다른 공간은 없다. */
  readonly project?: string;
  /** detached 공간이 그리는 탭의 key. 탭 값은 main에서 받고 이 key는 공간을 고르는 데만 쓴다. */
  readonly detached?: string;
  /** app 공간의 앱 id. 다른 공간은 없다. */
  readonly app?: string;
  /** app-window 공간이 그릴 앱 화면의 판·화면. 다른 공간은 없다. */
  readonly release?: string;
  readonly screen?: string;
  /** settings 공간에서 처음 보일 항목. 없으면 General이다. */
  readonly settingsPane?: SettingsPane;
  /** home·project·app 공간에서 열어 시작할 session. */
  readonly session?: string;
  /** `session`이 workspace의 기계가 아닌 기계의 것이면 그 기계. 같은 project 줄 안의 다른 기계 session이다. */
  readonly sessionMachine?: string;
  /** home·project·app 공간에서 새 session을 열어 시작한다(왼쪽 sidebar 다른 workspace 줄의 + hover 목록). */
  readonly startSession?: NewSessionStart;
  /** project·app 공간에서 그 workspace의 설정(Project settings·App details) 탭을 열어 시작한다(왼쪽 sidebar 다른 workspace 줄의 설정 단추). */
  readonly startSettings?: true;
  /** app 공간에서 앱 화면 탭을 열어(이미 있으면 골라) 시작한다(왼쪽 sidebar의 앱 줄). */
  readonly startAppScreen?: true;
  /** app 공간에서 그 앱 workspace의 lophn을 새 session으로 열어 시작한다. */
  readonly newSession?: true;
  /** project 공간에서 열어 시작할 터미널의 terminal_ref(다른 project의 터미널 알림). */
  readonly terminal?: string;
  /** project 공간에서 열어 시작할 파일. path는 디스크의 절대 경로다. */
  readonly open?: { readonly path: string; readonly line?: number };
}

export const HOME: Route = { space: "home" };

const on = (machine: string | undefined) =>
  machine === undefined ? {} : { machine };

/** Home으로 이동한다. session을 주면 그 Home session을 agent 탭으로 연다. 기계를 주면 그 기계의 Home이다. */
export function openHome(session?: string, machine?: string): Route {
  return session === undefined && machine === undefined
    ? HOME
    : {
        space: "home",
        ...(session === undefined ? {} : { session }),
        ...on(machine),
      };
}

/** Settings로 이동한다. 항목을 주면 그 항목부터 연다. */
export function openSettings(settingsPane?: SettingsPane): Route {
  return settingsPane === undefined
    ? { space: "settings" }
    : { space: "settings", settingsPane };
}

/** 프로젝트 작업대로 이동한다. `machine`을 주면 그 기계의 project다. */
export function openProject(
  project: string,
  start: Pick<
    Route,
    "session" | "sessionMachine" | "open" | "terminal" | "machine"
  > = {},
): Route {
  return { space: "project", project, ...start };
}

/** 앱 공간으로 이동한다. 기계를 주면 그 기계의 앱이다. */
export function openApp(
  app: string,
  session?: string,
  machine?: string,
): Route {
  return {
    space: "app",
    app,
    ...(session === undefined ? {} : { session }),
    ...on(machine),
  };
}

/** 앱 공간으로 가서 앱 화면 탭을 연다. */
export function openAppScreenAt(app: string, machine?: string): Route {
  return { space: "app", app, startAppScreen: true, ...on(machine) };
}

/** 그 workspace로 가서 session을 연다. `machine`은 session의 기계가 workspace의 기계와 다를 때만 준다. */
export function openWorkspaceSession(
  workspace: WorkspaceRef,
  session: string,
  machine?: string,
): Route {
  const start = {
    session,
    ...on(workspace.machine),
    ...(machine === undefined ? {} : { sessionMachine: machine }),
  };
  return workspace.kind === "home"
    ? { space: "home", ...start }
    : workspace.kind === "project"
      ? { space: "project", project: workspace.id, ...start }
      : { space: "app", app: workspace.id, ...start };
}

/** 그 workspace로 간다. */
export function openWorkspace(workspace: WorkspaceRef): Route {
  return workspace.kind === "home"
    ? openHome(undefined, workspace.machine)
    : workspace.kind === "project"
      ? openProject(workspace.id, on(workspace.machine))
      : openApp(workspace.id, undefined, workspace.machine);
}

/** 그 workspace로 가서 새 session을 연다. agent를 안 주면 그 workspace의 기본 lophn이다. */
export function openWorkspaceNewSession(
  workspace: WorkspaceRef,
  startSession: NewSessionStart = {},
): Route {
  const start = { startSession, ...on(workspace.machine) };
  return workspace.kind === "home"
    ? { space: "home", ...start }
    : workspace.kind === "project"
      ? { space: "project", project: workspace.id, ...start }
      : { space: "app", app: workspace.id, ...start };
}

/** 그 workspace로 가서 설정 탭을 연다. Home은 설정이 없어 그냥 간다. 설정 탭은 이 컴퓨터의 workspace만 연다. */
export function openWorkspaceSettings(workspace: WorkspaceRef): Route {
  return workspace.kind === "home" || workspace.machine !== undefined
    ? openWorkspace(workspace)
    : workspace.kind === "project"
      ? { space: "project", project: workspace.id, startSettings: true }
      : { space: "app", app: workspace.id, startSettings: true };
}

/** 방금 만든 앱의 앱 공간으로 이동한다. 오른쪽 패널이 그 앱 workspace의 lophn 새 session으로 열린다. */
export function openNewApp(app: string): Route {
  return { space: "app", app, newSession: true };
}

/** 앱 전용 창(앱 화면 하나만 그리는 OS 창)으로 시작한다. main이 이 hash로 창을 연다. */
export function openAppWindow(
  app: string,
  release: string,
  screen: string,
): Route {
  return { space: "app-window", app, release, screen };
}

/** detached 창(탭 하나만 그리는 OS 창)으로 시작한다. */
export function openDetached(key: string): Route {
  return { space: "detached", detached: key };
}
