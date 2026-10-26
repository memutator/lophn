// shell renderer가 쓰는 알림 통로. 채널 이름과 Electron event는 closure 안에만 있다.
import {
  type LophnNoticeApi,
  NOTICE_OPEN_CHANNEL,
  NOTICE_REVEAL_CHANNEL,
  NOTICE_TOAST_CHANNEL,
  NOTICE_UNSEEN_CHANNEL,
  NOTICE_UNSEEN_GET_CHANNEL,
  NOTICE_VISIBLE_CHANNEL,
  type UnseenSession,
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
  return Object.freeze(
    {
      visible: async (input) => {
        await transport.invoke(NOTICE_VISIBLE_CHANNEL, input).catch(() => {});
      },
      open: async (target) => {
        await transport.invoke(NOTICE_OPEN_CHANNEL, target).catch(() => {});
      },
      unseen: async () => {
        const sessions = await transport.invoke(NOTICE_UNSEEN_GET_CHANNEL)
          .catch(() => []);
        return Array.isArray(sessions) ? sessions as UnseenSession[] : [];
      },
      onUnseen: (listener) =>
        listen(
          NOTICE_UNSEEN_CHANNEL,
          (payload): payload is UnseenSession[] => Array.isArray(payload),
          listener,
        ),
      onToast: (listener) =>
        listen(
          NOTICE_TOAST_CHANNEL,
          (payload): payload is Parameters<typeof listener>[0] =>
            isRecord(payload) && typeof payload.id === "string",
          listener,
        ),
      onReveal: (listener) =>
        listen(
          NOTICE_REVEAL_CHANNEL,
          (payload): payload is { session: string } =>
            isRecord(payload) && typeof payload.session === "string",
          listener,
        ),
    } satisfies LophnNoticeApi,
  );
}
