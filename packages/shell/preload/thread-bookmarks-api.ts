import {
  THREAD_BOOKMARKS_CHANGED_CHANNEL,
  THREAD_BOOKMARKS_LIST_CHANNEL,
  THREAD_BOOKMARKS_SET_CHANNEL,
  type ThreadBookmarksApi,
  type ThreadBookmarksReply,
} from "../ipc/thread-bookmarks.ts";
import type { BrowserTransport } from "./browser-api.ts";

// 거절은 code 한 글자열만 싣는다. contextBridge가 Error의 다른 property를 넘기지 않는다.
async function call<T>(
  transport: BrowserTransport,
  channel: string,
  input: unknown,
): Promise<T> {
  let reply: ThreadBookmarksReply<T>;
  try {
    reply = (await transport.invoke(channel, input)) as ThreadBookmarksReply<T>;
  } catch {
    throw new Error("unavailable");
  }
  if (!reply.ok) throw new Error(reply.error.code);
  return reply.value;
}

// transport는 closure 안에 남는다. 저장은 main이 하고 여기서는 요청만 보낸다.
export function createThreadBookmarksApi(
  transport: BrowserTransport,
): ThreadBookmarksApi {
  return Object.freeze({
    list: (input) =>
      call<string[]>(transport, THREAD_BOOKMARKS_LIST_CHANNEL, input),
    set: async (input) => {
      await call<null>(transport, THREAD_BOOKMARKS_SET_CHANNEL, input);
    },
    onChanged: (listener) => {
      const callback = (_event: unknown, payload: unknown) =>
        listener((payload as { session: string }).session);
      transport.on(THREAD_BOOKMARKS_CHANGED_CHANNEL, callback);
      return () =>
        transport.removeListener(THREAD_BOOKMARKS_CHANGED_CHANNEL, callback);
    },
  } satisfies ThreadBookmarksApi);
}
