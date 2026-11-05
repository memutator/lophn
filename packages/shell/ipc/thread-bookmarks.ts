// shell renderer와 main 사이 thread bookmark 경계. main·preload·renderer가 함께 부르므로 import는 zod뿐이다.
import { z } from "zod";

export const THREAD_BOOKMARKS_LIST_CHANNEL = "shell:thread-bookmarks-list";
export const THREAD_BOOKMARKS_SET_CHANNEL = "shell:thread-bookmarks-set";
// main → renderer push. 바뀐 session만 싣고 받은 쪽이 list로 다시 읽는다.
export const THREAD_BOOKMARKS_CHANGED_CHANNEL =
  "shell:thread-bookmarks-changed";

const key = z.string().min(1).max(512);

export const threadBookmarksListSchema = z.object({ session: key }).strict();
export const threadBookmarksSetSchema = z
  .object({ session: key, message: key, on: z.boolean() })
  .strict();

export type ThreadBookmarksList = z.infer<typeof threadBookmarksListSchema>;
export type ThreadBookmarksSet = z.infer<typeof threadBookmarksSetSchema>;

/** main이 IPC로 돌려주는 모양. */
export type ThreadBookmarksReply<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: "invalid_input" | "forbidden" | "unavailable";
        message: string;
      };
    };

/** shell preload의 thread bookmark API(globalThis.lophnThreadBookmarks). 거절은 code만 실은 Error다. */
export interface ThreadBookmarksApi {
  /** session의 bookmark된 message key. */
  list(input: ThreadBookmarksList): Promise<string[]>;
  set(input: ThreadBookmarksSet): Promise<void>;
  /** 어느 창에서든 session의 bookmark가 바뀌었다. */
  onChanged(listener: (session: string) => void): () => void;
}
