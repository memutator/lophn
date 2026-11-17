// shell renderer가 쓰는 알림 통로. 채널 이름과 Electron event는 closure 안에만 있다.
import {
  type LophnNoticeApi,
  type NoticeReveal,
  NOTICE_OPEN_CHANNEL,
  NOTICE_REVEAL_CHANNEL,
  NOTICE_TOAST_CHANNEL,
  NOTICE_VISIBLE_CHANNEL,
} from "../ipc/notice.ts";

interface NoticeTransport {
  invoke(channel: string, input?: unknown): Promise<unknown>;
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
}

// main이 보낸 값이다. 모양은 main이 보낼 때 정했으므로 여기서는 주요 칸만 본다.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createNoticeApi(transport: NoticeTransport): LophnNoticeApi {
  function listen<T>(
    channel: string,
    accept: (payload: unknown) => payload is T,
    listener: (payload: T) => void,
  ): () => void {
    const callback = (_event: unknown, payload: unknown) => {
      if (accept(payload)) listener(payload);
    };
    transport.on(channel, callback);
    return () => transport.removeListener(channel, callback);
  }
  // 알림을 눌러 막 연 창에는 화면이 구독하기 전에 reveal이 온다. 마지막 하나를 들고 있다가 첫 구독에 넘긴다.
  const revealListeners = new Set<(reveal: NoticeReveal) => void>();
  let heldReveal: NoticeReveal | null = null;
  transport.on(NOTICE_REVEAL_CHANNEL, (_event, payload) => {
    if (
      !isRecord(payload) ||
      !(
        typeof payload.session === "string" ||
        typeof payload.app === "string" ||
        payload.inbox === true
      )
    ) {
      return;
    }
    const reveal = payload as NoticeReveal;
    if (revealListeners.size === 0) {
      heldReveal = reveal;
      return;
    }
    for (const listener of revealListeners) listener(reveal);
  });
  return Object.freeze({
    visible: async (input) => {
      await transport.invoke(NOTICE_VISIBLE_CHANNEL, input).catch(() => {});
    },
    open: async (target) => {
      await transport.invoke(NOTICE_OPEN_CHANNEL, target).catch(() => {});
    },
    onToast: (listener) =>
      listen(
        NOTICE_TOAST_CHANNEL,
        (payload): payload is Parameters<typeof listener>[0] =>
          isRecord(payload) && typeof payload.id === "string",
        listener,
      ),
    onReveal: (listener) => {
      revealListeners.add(listener);
      if (heldReveal !== null) {
        const reveal = heldReveal;
        heldReveal = null;
        listener(reveal);
      }
      return () => void revealListeners.delete(listener);
    },
  } satisfies LophnNoticeApi);
}
