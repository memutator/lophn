import {
  type Bookmark,
  type BookmarkList,
  bookmarkReasonSchema,
  BOOKMARKS_ADD_CHANNEL,
  BOOKMARKS_CHANGED_CHANNEL,
  BOOKMARKS_LIST_CHANNEL,
  BOOKMARKS_REMOVE_CHANNEL,
  BOOKMARKS_UPDATE_CHANNEL,
  BROWSER_ADOPT_CHANNEL,
  BROWSER_CLEAR_DATA_CHANNEL,
  BROWSER_COMMAND_CHANNEL,
  BROWSER_DEVTOOLS_CLOSE_CHANNEL,
  BROWSER_DEVTOOLS_OPEN_CHANNEL,
  BROWSER_DEVTOOLS_WINDOW_CHANNEL,
  BROWSER_EVENT_CHANNEL,
  BROWSER_NAVIGATE_CHANNEL,
  BROWSER_STATE_CHANNEL,
  browserEventSchema,
  type BrowserReply,
  type BrowserViewState,
  browserViewStateSchema,
  type LophnBrowserApi,
} from "../ipc/browser.ts";

export interface BrowserTransport {
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

// 거절은 한 글자열만 싣는다. contextBridge가 Error의 다른 property를 넘기지 않는다.
// handler가 없는 channel의 invoke 실패도 던지지 않고 unavailable로 거절한다.
async function call<T>(
  transport: BrowserTransport,
  channel: string,
  input: unknown,
  bookmark = false,
): Promise<T> {
  let reply: BrowserReply<T>;
  try {
    reply = (await transport.invoke(channel, input)) as BrowserReply<T>;
  } catch {
    throw new Error("unavailable");
  }
  if (!reply.ok) {
    const reason = bookmarkReasonSchema.safeParse(reply.error.message);
    throw new Error(
      bookmark && reason.success ? reason.data : reply.error.code,
    );
  }
  return reply.value;
}

function subscribe<T>(
  transport: BrowserTransport,
  channel: string,
  parse: (payload: unknown) => { success: true; data: T } | { success: false },
  listener: (value: T) => void,
): () => void {
  const callback = (_event: unknown, payload: unknown) => {
    const parsed = parse(payload);
    if (parsed.success) listener(parsed.data);
  };
  transport.on(channel, callback);
  return () => transport.removeListener(channel, callback);
}

// transport는 closure 안에 남는다. view 만들기·이동·bookmark 저장은 main이 하고 여기서는 요청만 보낸다.
export function createBrowserApi(transport: BrowserTransport): LophnBrowserApi {
  return Object.freeze({
    adopt: (input) =>
      call<BrowserViewState>(transport, BROWSER_ADOPT_CHANNEL, input),
    navigate: (input) =>
      call<BrowserViewState>(transport, BROWSER_NAVIGATE_CHANNEL, input),
    command: async (input) => {
      await call<null>(transport, BROWSER_COMMAND_CHANNEL, input);
    },
    clearData: async (profile) => {
      await call<null>(transport, BROWSER_CLEAR_DATA_CHANNEL, { profile });
    },
    devtools: Object.freeze({
      open: (input) =>
        call<{ devtools_session: string }>(
          transport,
          BROWSER_DEVTOOLS_OPEN_CHANNEL,
          input,
        ),
      close: async (input) => {
        await call<null>(transport, BROWSER_DEVTOOLS_CLOSE_CHANNEL, input);
      },
      window: async (input) => {
        await call<null>(transport, BROWSER_DEVTOOLS_WINDOW_CHANNEL, input);
      },
    }),
    subscribeState: (listener) =>
      subscribe(
        transport,
        BROWSER_STATE_CHANNEL,
        (payload) => browserViewStateSchema.safeParse(payload),
        listener,
      ),
    subscribeEvents: (listener) =>
      subscribe(
        transport,
        BROWSER_EVENT_CHANNEL,
        (payload) => browserEventSchema.safeParse(payload),
        listener,
      ),
    bookmarks: Object.freeze({
      list: () =>
        call<BookmarkList>(transport, BOOKMARKS_LIST_CHANNEL, undefined, true),
      add: (input) =>
        call<Bookmark>(transport, BOOKMARKS_ADD_CHANNEL, input, true),
      update: (input) =>
        call<Bookmark>(transport, BOOKMARKS_UPDATE_CHANNEL, input, true),
      remove: async (input) => {
        await call<null>(transport, BOOKMARKS_REMOVE_CHANNEL, input, true);
      },
      // payload 없음. 받은 쪽이 다시 읽는다.
      subscribe: (listener) =>
        subscribe(
          transport,
          BOOKMARKS_CHANGED_CHANNEL,
          () => ({ success: true, data: undefined }),
          () => listener(),
        ),
    }),
  } satisfies LophnBrowserApi);
}
