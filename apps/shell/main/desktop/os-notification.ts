// OS notification 표시(shell/desktop#R7, R10, platform/notifications#R9, R10, R12). 사람이
// 켰을 때만 지금 도착한 NotificationCreated 하나를 고정 제목·본문으로 OS에 올린다. 이름·내용·
// secret·원문 오류는 OS에 넘기지 않는다. 재연결 때 따라잡은 backlog는 올리지 않고, 같은
// notification은 이 main이 살아 있는 동안 한 번만 올린다. 클릭은 things-to-confirm을 열 뿐
// 읽음·결정이 아니다. OS 표시가 실패하면 그 기능만 안내하고 다시 시도하지 않는다.
// Electron Notification은 adapter 뒤에 둔다. 테스트와 headless는 실제 OS에 아무것도 올리지 않는다.
import { word } from "./wording.ts";

/** contracts/platform/notifications의 `NotificationCreated`. main tsc는 contracts를 보지 않는다. */
export const NOTIFICATION_CREATED = "NotificationCreated";

/** shell이 settings registry에 등록한 opt-in 항목(apps/core/shell.ts). 기본은 꺼짐이다. */
export const OS_NOTIFICATIONS_KEY = "shell.os_notifications";

/** event stream이 주는 envelope에서 쓰는 부분. */
export interface ArrivedEvent {
  readonly type: string;
  readonly subject: string | null;
}

/** OS에 넘기는 전부. 고정 문구뿐이다. */
export interface OsNote {
  readonly title: string;
  readonly body: string;
}

export interface OsNotifier {
  /** 이 OS·session에서 notification을 올릴 수 있는지. */
  isSupported(): boolean;
  /** 올린다. 실패하면 throw한다. onClick은 사람이 그 notification을 눌렀을 때만 부른다. */
  show(note: OsNote, onClick: () => void): void;
}

/** 안내할 실패 이유. OS 원문 오류는 담지 않는다. */
export type OsNotificationFailure = "unsupported" | "show-failed";

export type OsNotificationState = "ready" | "unavailable";

export interface OsNotificationOptions {
  notifier: OsNotifier;
  /** 사람이 켰는지. 지금 값을 읽는다. 읽지 못하면 false다(기본 꺼짐). */
  optedIn(): Promise<boolean>;
  /** notification을 누르면 things-to-confirm을 연다. notification id는 그 자리를 찾는 데만 쓴다. */
  open(notification: string): void;
  /** OS 표시가 처음 실패했을 때 한 번. 그 기능만 안내하고 이 실행에서는 더 올리지 않는다. */
  unavailable?(reason: OsNotificationFailure): void;
  log?(message: string): void;
}

export interface OsNotifications {
  /**
   * 지금 도착한 event(구독 socket의 frame). 재연결 때 따라잡은 목록은 넘기지 않는다
   * (shell/desktop#R7). NotificationCreated만 본다.
   */
  arrived(events: readonly ArrivedEvent[]): Promise<void>;
  readonly state: OsNotificationState;
}

/** 표시한 id를 기억하는 수. 넘으면 오래된 것부터 잊는다(재생은 cursor가 이미 막는다). */
export const SHOWN_MEMORY = 1000;

export const OS_NOTE: OsNote = {
  title: word("common.notification.title"),
  body: word("common.notification.body"),
};

export function createOsNotifications(
  options: OsNotificationOptions,
): OsNotifications {
  const shown = new Set<string>();
  let state: OsNotificationState = "ready";
  const log = options.log ?? defaultLog;

  const remember = (id: string) => {
    shown.add(id);
    if (shown.size > SHOWN_MEMORY) {
      const oldest = shown.values().next().value;
      if (oldest !== undefined) shown.delete(oldest);
    }
  };

  const fail = (reason: OsNotificationFailure) => {
    if (state === "unavailable") return;
    state = "unavailable";
    log(`OS notification을 올리지 못했다: ${reason}`);
    options.unavailable?.(reason);
  };

  const showOne = async (id: string) => {
    // 한 번 실패하면 이 실행에서는 더 올리지 않는다. 안내 하나로 끝내고 다시 두드리지 않는다.
    if (state === "unavailable") return;
    let on = false;
    try {
      on = await options.optedIn();
    } catch {
      on = false;
    }
    if (!on) return;
    if (!options.notifier.isSupported()) {
      fail("unsupported");
      return;
    }
    try {
      options.notifier.show(OS_NOTE, () => options.open(id));
    } catch {
      // 같은 notification을 다시 올리지 않는다. 창 안 chip과 things-to-confirm에는 남아 있다.
      fail("show-failed");
    }
  };

  return {
    get state() {
      return state;
    },
    async arrived(events) {
      for (const event of events) {
        const id = event.subject;
        if (event.type !== NOTIFICATION_CREATED || id === null) continue;
        if (shown.has(id)) continue;
        // 켜져 있지 않아도 기억한다. 나중에 켜도 지난 도착을 몰아 올리지 않는다.
        remember(id);
        await showOne(id);
      }
    },
  };
}

/** settings.get 응답에서 opt-in 값을 읽는다. true일 때만 켜짐이다. */
export function optInFromSettings(reply: unknown): boolean {
  if (typeof reply !== "object" || reply === null) return false;
  const settings = (reply as { settings?: unknown }).settings;
  if (!Array.isArray(settings)) return false;
  const found = settings.find((item) =>
    typeof item === "object" && item !== null &&
    (item as { key?: unknown }).key === OS_NOTIFICATIONS_KEY
  ) as { value?: unknown } | undefined;
  return found?.value === true;
}

function defaultLog(message: string): void {
  console.log(`[lophn] ${message}`);
}
