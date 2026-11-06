// 앱 process가 사람에게 알린다. 받는 쪽은 사람의 Inbox와 toast·OS 알림뿐이다. agent나 core 로직에 사실을
// 보내는 길이 아니고, 앱 UI view에서는 부르지 못한다. 시작 코드·command·operation·flow에서 부른다.
import { CapabilityError, fromBroker, missingHost } from "./errors.ts";
import { type CapHost, readHost } from "./host.ts";

export const NOTIFY_SEND_PATH = "/_lophn/broker/notify/send";

// protocol/apps/notice.ts의 한도와 같다(SDK는 protocol을 import할 수 없어 사본으로 둔다).
export const NOTIFY_TITLE_MAX = 120;
export const NOTIFY_BODY_MAX = 500;
export const NOTIFY_KEY_MAX = 64;
const KEY = /^[A-Za-z0-9_.:-]+$/;

export type NotifyRequest = {
  // 한 줄 제목. 1~120자. 앞뒤 공백은 지운다.
  title: string;
  // 일반 글 본문. 500자까지.
  body?: string;
  // 같은 key의 열린 notice가 있으면 그것을 대신한다(내용 갱신, 맨 뒤로, toast 다시). 없으면 매번 더한다.
  // 1~64자의 영문자·숫자·`_.:-`.
  key?: string;
};

export type NotifyResult = { notified: true; standIn?: true };

export type NotifyClient = {
  notify(request: NotifyRequest): Promise<NotifyResult>;
};

function invalid(message: string): CapabilityError {
  return new CapabilityError({ code: "invalid_input", message });
}

function check(request: NotifyRequest): void {
  const title = typeof request.title === "string" ? request.title.trim() : "";
  if (title.length === 0 || title.length > NOTIFY_TITLE_MAX) {
    throw invalid(`title must be 1 to ${NOTIFY_TITLE_MAX} characters`);
  }
  if (
    request.body !== undefined &&
    (typeof request.body !== "string" ||
      request.body.trim().length > NOTIFY_BODY_MAX)
  ) {
    throw invalid(`body must be at most ${NOTIFY_BODY_MAX} characters`);
  }
  if (
    request.key !== undefined &&
    (typeof request.key !== "string" ||
      request.key.length > NOTIFY_KEY_MAX ||
      !KEY.test(request.key))
  ) {
    throw invalid(
      `key must be 1 to ${NOTIFY_KEY_MAX} characters of letters, digits and _.:-`,
    );
  }
}

export type NotifyClientDeps = { host?: CapHost };

export function createNotifyClient(deps: NotifyClientDeps = {}): NotifyClient {
  return {
    async notify(request) {
      check(request);
      const host = deps.host ?? readHost();
      if (!host) throw missingHost();
      // preview·test는 사람에게 닿지 않는다.
      if (host.mode !== "live") return { notified: true, standIn: true };
      const requested = { permission: "notify.send", scope: {} };
      let response;
      try {
        response = await host.post(NOTIFY_SEND_PATH, {
          title: request.title,
          ...(request.body === undefined ? {} : { body: request.body }),
          ...(request.key === undefined ? {} : { key: request.key }),
        });
      } catch {
        throw new CapabilityError({
          code: "unavailable",
          message: "notify could not reach the broker",
        });
      }
      if (response.status !== 200) throw fromBroker(response.body, requested);
      return { notified: true };
    },
  };
}

// 앱 코드가 쓰는 기본 client다. host는 호출할 때 읽는다.
const shared = createNotifyClient();

export function notify(request: NotifyRequest): Promise<NotifyResult> {
  return shared.notify(request);
}
