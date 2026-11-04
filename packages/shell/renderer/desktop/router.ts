import type { PlaceRef } from "../shell/desk-model.ts";
import type { SettingsPane } from "./settings/model.ts";

// 창 안의 자리. 새 기본 창은 언제나 Home에서 시작한다.
type Space =
  | "home"
  | "settings"
  | "project"
  | "app"
  | "app-window"
  | "detached"
  | "harness-gui";

export interface Route {
  readonly space: Space;
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
  /** home·project·app 공간에서 그 place의 lophn 새 session 탭을 열어 시작한다(왼쪽 sidebar 다른 place 줄의 +). */
  readonly startSession?: true;
  /** app 공간에서 그 앱 place의 lophn을 새 session으로 열어 시작한다. */
  readonly newSession?: true;
  /** project 공간에서 열어 시작할 터미널의 terminal_ref(다른 project의 터미널 알림). */
  readonly terminal?: string;
  /** project 공간에서 열어 시작할 파일. path는 디스크의 절대 경로다. */
  readonly open?: { readonly path: string; readonly line?: number };
}

export const HOME: Route = { space: "home" };

/** Home으로 이동한다. session을 주면 그 Home session을 agent 탭으로 연다. */
export function openHome(session?: string): Route {
  return session === undefined ? HOME : { space: "home", session };
}

/** Settings로 이동한다. 항목을 주면 그 항목부터 연다. */
export function openSettings(settingsPane?: SettingsPane): Route {
  return settingsPane === undefined
    ? { space: "settings" }
    : { space: "settings", settingsPane };
}

/** 프로젝트 작업대로 이동한다. */
export function openProject(
  project: string,
  start: Pick<Route, "session" | "open" | "terminal"> = {},
): Route {
  return { space: "project", project, ...start };
}

/** 앱 공간으로 이동한다. */
export function openApp(app: string, session?: string): Route {
  return session === undefined
    ? { space: "app", app }
    : { space: "app", app, session };
}

/** 그 place로 가서 lophn 새 session 탭을 연다. */
export function openPlaceNewSession(place: PlaceRef): Route {
  return place.kind === "home"
    ? { space: "home", startSession: true }
    : place.kind === "project"
      ? { space: "project", project: place.id, startSession: true }
      : { space: "app", app: place.id, startSession: true };
}

/** 방금 만든 앱의 앱 공간으로 이동한다. 오른쪽 패널이 그 앱 place의 lophn 새 session으로 열린다. */
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

/** harness-gui 창(extension이 연 ACP session 하나만 그리는 OS 창)으로 시작한다. main이 이 hash로 창을 연다. */
export function openHarnessGui(): Route {
  return { space: "harness-gui" };
}
