// shell renderer의 bookmark IPC. 매 요청마다 sender가 살아 있는 desktop 창 main frame인지,
// 입력이 schema에 맞는지 본다. 저장은 main의 store 하나뿐이라 성공한 쓰기 뒤에 모든 창에
// 알리고, 받은 창이 list로 다시 읽는다(알림에 내용을 싣지 않는다).
import type { ZodType } from "zod";

import {
  type Bookmark,
  bookmarkAddSchema,
  type BookmarkList,
  type BookmarkReason,
  bookmarkRemoveSchema,
  BOOKMARKS_ADD_CHANNEL,
  BOOKMARKS_LIST_CHANNEL,
  BOOKMARKS_REMOVE_CHANNEL,
  BOOKMARKS_UPDATE_CHANNEL,
  bookmarkUpdateSchema,
  type BrowserReply,
} from "../../ipc/browser.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import type { createBookmarkStore } from "./bookmarks.ts";

type Failure = Extract<BrowserReply<never>, { ok: false }>;

interface BookmarkIpcDeps {
  registry: ContentsRegistry;
  store: Pick<
    ReturnType<typeof createBookmarkStore>,
    "list" | "add" | "update" | "remove"
  >;
  /** 열린 모든 shell 창에 BOOKMARKS_CHANGED_CHANNEL을 보낸다. */
  notify(): void;
}

interface BookmarkIpcHandlers {
  list(event: IpcEvent): Promise<BrowserReply<BookmarkList>>;
  add(event: IpcEvent, input: unknown): Promise<BrowserReply<Bookmark>>;
  update(event: IpcEvent, input: unknown): Promise<BrowserReply<Bookmark>>;
  remove(event: IpcEvent, input: unknown): Promise<BrowserReply<null>>;
}

const DESKTOP_HOST = "desktop";

const CODES: Record<BookmarkReason, Failure["error"]["code"]> = {
  url: "invalid_input",
  title: "invalid_input",
  limit: "invalid_input",
  duplicate: "conflict",
  missing: "not_found",
  corrupt: "unavailable",
  unreadable: "unavailable",
  unwritable: "unavailable",
};

function failure(reason: BookmarkReason): Failure {
  return { ok: false, error: { code: CODES[reason], message: reason } };
}

export function createBookmarkIpc(deps: BookmarkIpcDeps): BookmarkIpcHandlers {
  function checkDesktop(event: IpcEvent): Failure | undefined {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return caller;
    if (caller.value.origin.host !== DESKTOP_HOST) {
      return {
        ok: false,
        error: { code: "forbidden", message: "caller is not a desktop window" },
      };
    }
    return undefined;
  }

  // caller와 입력을 차례로 본다.
  function guard<T>(
    event: IpcEvent,
    schema: ZodType<T>,
    input: unknown,
  ): BrowserReply<T> {
    const denied = checkDesktop(event);
    if (denied) return denied;
    return checkInput(schema, input);
  }

  // 성공한 쓰기만 알린다.
  function settle<T, R>(
    outcome: { ok: true; value: T } | { ok: false; reason: BookmarkReason },
    map: (value: T) => R,
  ): BrowserReply<R> {
    if (!outcome.ok) return failure(outcome.reason);
    deps.notify();
    return { ok: true, value: map(outcome.value) };
  }

  return {
    async list(event) {
      const denied = checkDesktop(event);
      if (denied) return denied;
      const listed = await deps.store.list();
      return listed.ok ? listed : failure(listed.reason);
    },
    async add(event, input) {
      const checked = guard(event, bookmarkAddSchema, input);
      if (!checked.ok) return checked;
      return settle(await deps.store.add(checked.value), (value) => value);
    },
    async update(event, input) {
      const checked = guard(event, bookmarkUpdateSchema, input);
      if (!checked.ok) return checked;
      return settle(await deps.store.update(checked.value), (value) => value);
    },
    async remove(event, input) {
      const checked = guard(event, bookmarkRemoveSchema, input);
      if (!checked.ok) return checked;
      return settle(await deps.store.remove(checked.value.id), () => null);
    },
  };
}

interface BookmarkIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

const CHANNELS = [
  [BOOKMARKS_LIST_CHANNEL, "list"],
  [BOOKMARKS_ADD_CHANNEL, "add"],
  [BOOKMARKS_UPDATE_CHANNEL, "update"],
  [BOOKMARKS_REMOVE_CHANNEL, "remove"],
] as const;

export function registerBookmarkIpc(
  ipc: BookmarkIpcMain,
  handlers: BookmarkIpcHandlers,
): void {
  for (const [channel, method] of CHANNELS) {
    ipc.handle(channel, (event, input) => handlers[method](event, input));
  }
}

export function removeBookmarkIpc(
  ipc: Pick<BookmarkIpcMain, "removeHandler">,
): void {
  for (const [channel] of CHANNELS) ipc.removeHandler(channel);
}
