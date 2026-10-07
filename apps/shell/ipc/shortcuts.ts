// 창 안 shortcut. main이 창의 모든 webContents에서 키를 보고 이 이름 하나만 shell
// renderer로 보낸다. renderer는 같은 표로 팔레트 행의 키 이름을 그린다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

/** main이 shell renderer로 보내는 channel. payload는 WindowShortcut 하나다. */
export const WINDOW_SHORTCUT_CHANNEL = "shell:shortcut";

/**
 * 창 안에서만 듣는 키(shell/desktop#R18). 전역 팔레트 CommandOrControl+Shift+K는
 * 전역 등록이 맡고(main/desktop/global-shortcut.ts) 이 표에 넣지 않는다. 전역 Ctrl+K는
 * 어디서도 등록하지 않는다.
 */
export const WINDOW_SHORTCUTS = {
  palette: "CommandOrControl+K",
  launcher: "CommandOrControl+Shift+L",
} as const;

export type WindowShortcut = keyof typeof WINDOW_SHORTCUTS;

export function isWindowShortcut(value: unknown): value is WindowShortcut {
  return typeof value === "string" && Object.hasOwn(WINDOW_SHORTCUTS, value);
}

export interface ShortcutApi {
  subscribe(listener: (shortcut: WindowShortcut) => void): () => void;
}

/** OS 전역 단축키 하나(shell#T56). main만 등록하고 renderer는 키 이름을 그릴 때만 본다. */
export const GLOBAL_PALETTE_ACCELERATOR = "CommandOrControl+Shift+K";

/** main이 창 하나를 앞으로 가져온 뒤 그 shell renderer로 보내는 channel. */
export const DESKTOP_INTENT_CHANNEL = "shell:intent";

/**
 * main이 창 밖에서 일어난 일로 창에 시키는 것. `global-palette`는 전역 팔레트 키,
 * `things-to-confirm`은 OS notification 클릭이다. 클릭은 읽음·결정이 아니다.
 */
export const DESKTOP_INTENTS = ["global-palette", "things-to-confirm"] as const;

/**
 * `lophn://things-to-confirm/<id>` 링크(desktop#R14). things-to-confirm에서 그 요청을 고른
 * 화면을 연다. confirmation window는 열지 않는다(사람이 그 화면에서 누를 때 연다).
 */
export interface ConfirmTargetIntent {
  readonly kind: "things-to-confirm";
  readonly request: string;
}

/**
 * [Report a problem]으로 접수된 feedback이 묶인 Issue(problems/feedback#R13). 그 앱 공간을 연다.
 * 앱·문제 ID는 main이 접수 결과에서 정하고 화면에는 보이지 않는다.
 */
export interface AppIssueIntent {
  readonly kind: "app-issue";
  readonly app: string;
  readonly problem: string;
}

/**
 * `lophn://things-to-confirm/<cac|tkt|app id>` 링크(coding agent 회수·취소·생성). target은 연결(`cac_`)·
 * Task(`tkt_`)·앱(`app_`) 하나이고 renderer가 그 대상의 화면을 연다. 결정 창은 사람이 그 화면에서 누를 때 연다.
 */
export interface CodingTargetIntent {
  readonly kind: "coding";
  readonly target: string;
}

export type DesktopIntent =
  | typeof DESKTOP_INTENTS[number]
  | ConfirmTargetIntent
  | AppIssueIntent
  | CodingTargetIntent;

const CONFIRM_TARGET = /^(?:apr|qst)_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const CODING_TARGET = /^(?:cac|tkt|app)_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const PROBLEM_ID = /^prb_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

export function isDesktopIntent(value: unknown): value is DesktopIntent {
  if (typeof value === "string") {
    return (DESKTOP_INTENTS as readonly string[]).includes(value);
  }
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  if (target.kind === "app-issue") {
    return Object.keys(target).sort().join(",") === "app,kind,problem" &&
      typeof target.app === "string" && APP_ID.test(target.app) &&
      typeof target.problem === "string" && PROBLEM_ID.test(target.problem);
  }
  if (target.kind === "coding") {
    return Object.keys(target).sort().join(",") === "kind,target" &&
      typeof target.target === "string" && CODING_TARGET.test(target.target);
  }
  return Object.keys(target).sort().join(",") === "kind,request" &&
    target.kind === "things-to-confirm" &&
    typeof target.request === "string" && CONFIRM_TARGET.test(target.request);
}

export interface IntentApi {
  subscribe(listener: (intent: DesktopIntent) => void): () => void;
}
