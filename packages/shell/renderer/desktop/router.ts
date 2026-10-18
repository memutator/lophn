import type { InstructionsPlace } from "../../ipc/instructions.ts";
import type { SettingsPane } from "./settings/model.ts";

// 창 안의 자리. 새 기본 창은 언제나 런처에서 시작한다.
type Space =
  | "launcher"
  | "settings"
  | "project"
  | "app"
  | "instructions"
  | "detached";

export interface Route {
  readonly space: Space;
  /** project 공간의 프로젝트 id. 다른 공간은 없다. */
  readonly project?: string;
  /** detached 공간이 그리는 탭의 key. 탭 값은 main에서 받고 이 key는 공간을 고르는 데만 쓴다. */
  readonly detached?: string;
  /** app 공간의 앱 id. 다른 공간은 없다. */
  readonly app?: string;
  /** settings 공간에서 처음 보일 항목. 없으면 General이다. */
  readonly settingsPane?: SettingsPane;
  /** instructions 공간이 여는 지침 층. settings·project-workspace·app-detail의 [Instructions]가 쓴다. */
  readonly instructions?: InstructionsPlace;
  /** app 공간에서 Issues 탭으로, 고른 채 열 문제. report-problem dialog의 [View issue]가 쓴다. */
  readonly issueProblem?: string;
  /** project·app 공간에서 열어 시작할 session. */
  readonly session?: string;
  /** project 공간에서 그 project의 Project Manager를 위반(context와 검사)을 붙여 열어 시작한다. */
  readonly projectManager?: {
    readonly context: string;
    readonly check: string;
  };
  /** project 공간에서 열어 시작할 파일. path는 디스크의 절대 경로다. */
  readonly open?: { readonly path: string; readonly line?: number };
}

export const LAUNCHER: Route = { space: "launcher" };

/** Settings로 이동한다. 항목을 주면 그 항목부터 연다. */
export function openSettings(settingsPane?: SettingsPane): Route {
  return settingsPane === undefined
    ? { space: "settings" }
    : { space: "settings", settingsPane };
}

/** 프로젝트 작업대로 이동한다. */
export function openProject(
  project: string,
  start: Pick<Route, "session" | "projectManager" | "open"> = {},
): Route {
  return { space: "project", project, ...start };
}

/** [Instructions] 편집기로 이동한다. */
export function openInstructions(place: InstructionsPlace): Route {
  return { space: "instructions", instructions: place };
}

/** 앱 공간으로 이동한다. */
export function openApp(app: string, session?: string): Route {
  return session === undefined
    ? { space: "app", app }
    : { space: "app", app, session };
}

/** detached 창(탭 하나만 그리는 OS 창)으로 시작한다. */
export function openDetached(key: string): Route {
  return { space: "detached", detached: key };
}
