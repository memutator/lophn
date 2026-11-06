// thread bookmark IPC. 매 요청마다 sender가 살아 있는 desktop 창(detached 창 포함) main frame인지, 입력이 schema에
// 맞는지 본다. 저장은 main의 store 하나뿐이라 성공한 쓰기 뒤에 모든 창에 알리고, 받은 창이 list로 다시 읽는다.
import type { ZodType } from "zod";

import {
  THREAD_BOOKMARKS_LIST_CHANNEL,
  THREAD_BOOKMARKS_SET_CHANNEL,
  threadBookmarksListSchema,
  type ThreadBookmarksReply,
  threadBookmarksSetSchema,
} from "../../ipc/thread-bookmarks.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import type { createThreadBookmarkStore } from "./store.ts";

type Failure = Extract<ThreadBookmarksReply<never>, { ok: false }>;

interface ThreadBookmarkIpcDeps {
  registry: ContentsRegistry;
  store: ReturnType<typeof createThreadBookmarkStore>;
  /** 열린 모든 shell 창에 THREAD_BOOKMARKS_CHANGED_CHANNEL을 보낸다. */
  notify(session: string): void;
}

interface ThreadBookmarkIpcHandlers {
  list(
    event: IpcEvent,
    input: unknown,
  ): Promise<ThreadBookmarksReply<string[]>>;
  set(event: IpcEvent, input: unknown): Promise<ThreadBookmarksReply<null>>;
}

const DESKTOP_HOST = "desktop";

const failure = (reason: string): Failure => ({
  ok: false,
  error: { code: "unavailable", message: reason },
});

export function createThreadBookmarkIpc(
  deps: ThreadBookmarkIpcDeps,
): ThreadBookmarkIpcHandlers {
  function guard<T>(
    event: IpcEvent,
    schema: ZodType<T>,
    input: unknown,
  ): ThreadBookmarksReply<T> {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return caller;
    if (caller.value.origin.host !== DESKTOP_HOST) {
      return {
        ok: false,
        error: { code: "forbidden", message: "caller is not a desktop window" },
      };
    }
    return checkInput(schema, input);
  }

  return {
    async list(event, input) {
      const checked = guard(event, threadBookmarksListSchema, input);
      if (!checked.ok) return checked;
      const listed = await deps.store.list(checked.value.session);
      return listed.ok ? listed : failure(listed.reason);
    },
    async set(event, input) {
      const checked = guard(event, threadBookmarksSetSchema, input);
      if (!checked.ok) return checked;
      const { session, message, on } = checked.value;
      const done = await deps.store.set(session, message, on);
      if (!done.ok) return failure(done.reason);
      deps.notify(session);
      return done;
    },
  };
}

interface ThreadBookmarkIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

const CHANNELS = [
  [THREAD_BOOKMARKS_LIST_CHANNEL, "list"],
  [THREAD_BOOKMARKS_SET_CHANNEL, "set"],
] as const;

export function registerThreadBookmarkIpc(
  ipc: ThreadBookmarkIpcMain,
  handlers: ThreadBookmarkIpcHandlers,
): void {
  for (const [channel, method] of CHANNELS) {
    ipc.handle(channel, (event, input) => handlers[method](event, input));
  }
}

export function removeThreadBookmarkIpc(
  ipc: Pick<ThreadBookmarkIpcMain, "removeHandler">,
): void {
  for (const [channel] of CHANNELS) ipc.removeHandler(channel);
}
