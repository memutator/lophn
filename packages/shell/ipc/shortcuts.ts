// 창 안 shortcut. main이 창의 모든 webContents에서 키를 보고 이 이름 하나만 shell
// renderer로 보낸다. renderer는 같은 표로 팔레트 행의 키 이름을 그린다.
// 작업대 단축키(탭·칸·sidebar·팔레트·Home)는 keybindings.ts의 표가 정하고, 그중 main이 먼저 받아야
// 하는 것(menu와 겹치는 Cmd+W, page가 삼키는 키)만 이 channel로 온다. 그 payload는 binding id 글자다.
import { parseBindingId } from "../../protocol/shell/keybindings.ts";

/** main이 shell renderer로 보내는 channel. payload는 WindowShortcut(binding id) 하나다. */
export const WINDOW_SHORTCUT_CHANNEL = "shell:shortcut";

/**
 * channel로 오는 binding id(`tab.close`, `desk.nth:3`, `palette.open`, `app.panel:<app>:<surface>`).
 * 표가 아는 모양만 받는다.
 */
export type WindowShortcut = string;

export function isWindowShortcut(value: unknown): value is WindowShortcut {
  return typeof value === "string" && parseBindingId(value) !== null;
}

export interface ShortcutApi {
  subscribe(listener: (shortcut: WindowShortcut) => void): () => void;
  /** lophn이 이 창의 page에 넣는 input의 알림(DriverInputMessage). */
  subscribeDriverInput(
    listener: (message: DriverInputMessage) => void,
  ): () => void;
  /** start에 답한다(표시를 받았고, 사람의 keyboard focus가 그 page에 있었는가). */
  answerDriverInput(answer: DriverInputAnswer): void;
}

/**
 * main이 shell renderer로 보내는 channel. agent·멀리서 보기의 input이 창의 page(webContents id)에 들어가는 동안 창이 사람의
 * keyboard focus를 제자리에 두게 한다(browser/agent/input.ts). start·end는 page마다 짝이고, tab은 그 page에 Tab이 들어가 focus가
 * page 밖으로 나갈 수 있다는 것, person은 사람이 그 page(표시되지 않은 page일 수 있다)를 눌렀다는 것이다.
 */
export const DRIVER_INPUT_CHANNEL = "shell:driver-input";

const DRIVER_INPUT_EVENTS = ["start", "end", "tab", "person"] as const;

export interface DriverInputMessage {
  page: number;
  event: (typeof DRIVER_INPUT_EVENTS)[number];
}

export function isDriverInputMessage(
  value: unknown,
): value is DriverInputMessage {
  if (typeof value !== "object" || value === null) return false;
  const { page, event } = value as Record<string, unknown>;
  return (
    Number.isInteger(page) &&
    (DRIVER_INPUT_EVENTS as readonly unknown[]).includes(event)
  );
}

/** renderer가 main으로 보내는 start의 답. person은 사람의 keyboard focus가 그 page에 있었다는 것이다. */
export const DRIVER_FOCUS_CHANNEL = "shell:driver-focus";

export interface DriverInputAnswer {
  page: number;
  person: boolean;
}

export function isDriverInputAnswer(
  value: unknown,
): value is DriverInputAnswer {
  if (typeof value !== "object" || value === null) return false;
  const { page, person } = value as Record<string, unknown>;
  return Number.isInteger(page) && typeof person === "boolean";
}

/** OS 전역 단축키 하나. main만 등록하고 renderer는 키 이름을 그릴 때만 본다. */
export const GLOBAL_PALETTE_ACCELERATOR = "CommandOrControl+Shift+K";

/** main이 창 하나를 앞으로 가져온 뒤 그 shell renderer로 보내는 channel. */
export const DESKTOP_INTENT_CHANNEL = "shell:intent";

/**
 * main이 창 밖에서 일어난 일로 창에 시키는 것. `global-palette`는 전역 팔레트 키이고,
 * `remote-settings`는 옮겨진 로그인 시작 알림의 [Open settings]가 Settings › Remote를 열라는 것이다.
 */
const DESKTOP_INTENTS = ["global-palette", "remote-settings"] as const;

export type DesktopIntent = (typeof DESKTOP_INTENTS)[number];

export function isDesktopIntent(value: unknown): value is DesktopIntent {
  return (
    typeof value === "string" &&
    (DESKTOP_INTENTS as readonly string[]).includes(value)
  );
}

export interface IntentApi {
  subscribe(listener: (intent: DesktopIntent) => void): () => void;
}
