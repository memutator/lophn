// OS notification 표시(shell/desktop#R7, R10, platform/notifications#R9, R10, R12). 지금 도착한
// NotificationCreated 하나마다 core에 OS 표시 요청(redaction한 계기 종류와 열 곳, 사람이 켰을
// 때만 값이 있다)을 받아, 그 종류의 고정 문구로만 OS에 올린다. 이름·내용·secret·원문 오류는
// OS에 넘기지 않는다. 재연결 때 따라잡은 backlog는 올리지 않고, 같은 notification은 이 main이
// 살아 있는 동안 한 번만 올린다. 클릭은 things-to-confirm을 열 뿐 읽음·결정이 아니다. OS 표시가
// 실패하면 그 기능만 안내하고, 고정 이유 하나만 core에 알려 다음 조회에서 보이게 한다. 다시
// 시도하는 루프는 없다.
// Electron Notification은 adapter 뒤에 둔다. 테스트와 headless는 실제 OS에 아무것도 올리지 않는다.
import { type PlainKey, word } from "./wording.ts";

/** contracts/platform/notifications의 `NotificationCreated`. main tsc는 contracts를 보지 않는다. */
export const NOTIFICATION_CREATED = "NotificationCreated";

/** shell이 settings registry에 등록한 opt-in 항목(apps/core/shell.ts). 기본은 꺼짐이다. */
export const OS_NOTIFICATIONS_KEY = "shell.os_notifications";

/** event stream이 주는 envelope에서 쓰는 부분. */
export interface ArrivedEvent {
  readonly type: string;
  readonly subject: string | null;
}

/** core가 준 OS 표시 요청(contracts/platform/notifications의 OsDisplay). */
export interface OsDisplayRequest {
  readonly notification: string;
  readonly title: { readonly kind: string };
  readonly open: { readonly kind: string; readonly id: string } | null;
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

/** core에 알리는 고정 이유(contracts/platform/notifications의 OS_DELIVERY_FAILURE_REASONS). */
export type OsDeliveryReason = "unsupported" | "show_failed";

export type OsNotificationState = "ready" | "unavailable";

export interface OsNotificationOptions {
  notifier: OsNotifier;
  /**
   * core에서 이 notification의 OS 표시 요청을 받는다. 사람이 켜지 않았거나 읽지 못하거나
   * 없는 notification이면 null이다(기본 꺼짐).
   */
  display(notification: string): Promise<OsDisplayRequest | null>;
  /** 표시 실패를 고정 이유로 core에 알린다. 실패해도 다시 시도하지 않는다. */
  report?(notification: string, reason: OsDeliveryReason): Promise<void>;
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

/** 계기 종류마다 정한 고정 문구. 표 밖 종류는 일반 안내다(things-to-confirm의 계기 이름과 같다). */
const BODY_BY_KIND: Readonly<Record<string, PlainKey>> = {
  QuestionCreated: "things-to-confirm.label.event-question",
  ApprovalRequestCreated: "things-to-confirm.label.event-decision",
  ProblemOpened: "things-to-confirm.label.event-issue-opened",
  ProblemReopened: "things-to-confirm.label.event-issue-reopened",
  ProblemClosed: "things-to-confirm.label.event-issue-closed",
  TicketConfirmed: "things-to-confirm.label.event-task-confirmed",
  TicketCheckFailed: "things-to-confirm.label.event-task-check-failed",
  AssignmentPaused: "things-to-confirm.label.event-paused",
  ReleaseActivationFailed: "things-to-confirm.label.event-activation-failed",
};

/** OS에 올릴 문구. 제목은 늘 lophn이고 본문은 계기 종류의 고정 문구다. */
export function noteOf(request: OsDisplayRequest): OsNote {
  const key = Object.hasOwn(BODY_BY_KIND, request.title.kind)
    ? BODY_BY_KIND[request.title.kind]!
    : "common.notification.body";
  return { title: word("common.notification.title"), body: word(key) };
}

/** notifications/display 응답에서 요청을 읽는다. 모양이 다르면 null이다. */
export function displayFromReply(reply: unknown): OsDisplayRequest | null {
  if (typeof reply !== "object" || reply === null) return null;
  const display = (reply as { display?: unknown }).display;
  if (typeof display !== "object" || display === null) return null;
  const { notification, title, open } = display as Record<string, unknown>;
  if (typeof notification !== "string") return null;
  if (typeof title !== "object" || title === null) return null;
  const kind = (title as { kind?: unknown }).kind;
  if (typeof kind !== "string") return null;
  let target: OsDisplayRequest["open"] = null;
  if (typeof open === "object" && open !== null) {
    const { kind: openKind, id } = open as Record<string, unknown>;
    if (typeof openKind === "string" && typeof id === "string") {
      target = { kind: openKind, id };
    }
  }
  return { notification, title: { kind }, open: target };
}

export function createOsNotifications(
  options: OsNotificationOptions,
): OsNotifications {
  const shown = new Set<string>();
  let state: OsNotificationState = "ready";
  let failure: OsNotificationFailure | undefined;
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
    failure = reason;
    log(`OS notification을 올리지 못했다: ${reason}`);
    options.unavailable?.(reason);
  };

  // core에 알리는 이유는 고정 값 둘뿐이다. 알리지 못해도 다시 시도하지 않는다.
  const report = async (id: string, reason: OsNotificationFailure) => {
    try {
      await options.report?.(
        id,
        reason === "unsupported" ? "unsupported" : "show_failed",
      );
    } catch {
      log("OS notification 실패를 core에 알리지 못했다");
    }
  };

  const showOne = async (id: string) => {
    let request: OsDisplayRequest | null = null;
    try {
      request = await options.display(id);
    } catch {
      request = null;
    }
    // 켜지 않았거나 읽지 못하면 아무것도 올리지 않고 알리지도 않는다.
    if (request === null) return;
    // 한 번 실패하면 이 실행에서는 더 올리지 않는다. OS를 다시 두드리지 않고, 올리지 못한
    // 사실만 같은 이유로 core에 남긴다.
    if (state === "unavailable") {
      if (failure !== undefined) await report(id, failure);
      return;
    }
    if (!options.notifier.isSupported()) {
      fail("unsupported");
      await report(id, "unsupported");
      return;
    }
    try {
      options.notifier.show(noteOf(request), () => options.open(id));
    } catch {
      // 같은 notification을 다시 올리지 않는다. 창 안 chip과 things-to-confirm에는 남아 있다.
      fail("show-failed");
      await report(id, "show-failed");
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
