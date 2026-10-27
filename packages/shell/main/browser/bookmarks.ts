// bookmark는 <dataRoot>/shell/bookmarks.json 하나에 main만 쓴다. 사람이 모은 목록이라
// 파일이 깨져 있으면(JSON 아님, schema·version 불일치) 어떤 쓰기도 그 파일을 덮어쓰지 않는다.
// 옛 version을 옮겨 읽지도 않는다. corrupt로 두고 사람이 파일을 고치게 한다.
import { join } from "node:path";
import { z } from "zod";

import {
  defaultStoreDeps,
  type StoreDeps,
  writeFileAtomic,
} from "../workspace/atomic-file.ts";
import type {
  Bookmark,
  BookmarkList,
  BookmarkReason,
} from "../../ipc/browser.ts";

export type { Bookmark, BookmarkList, BookmarkReason };

type Outcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: BookmarkReason;
    };

const TITLE_MAX = 200;
const URL_MAX = 8192;
const BOOKMARK_MAX = 1000;
const FAVICON_MAX = 65536;

// 선택 칸이라 favicon 없는 파일도 그대로 읽힌다. 맞지 않는 favicon이 든 파일은 다른 칸처럼 corrupt다.
const favicon = z.string().max(FAVICON_MAX).startsWith("data:image/");

const fileSchema = z.strictObject({
  version: z.literal(1),
  bookmarks: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      created_at: z.string(),
      favicon: favicon.optional(),
    }),
  ),
});

/** 통과하면 저장할 href, 아니면 undefined다. http/https이고 userinfo가 없어야 한다. */
function checkUrl(value: string): string | undefined {
  if (value.length > URL_MAX) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return url.href;
}

function checkTitle(value: string): string | undefined {
  const title = value.trim();
  return title.length >= 1 && title.length <= TITLE_MAX ? title : undefined;
}

export function createBookmarkStore(
  dataRoot: string,
  deps: {
    ids: { bookmark(): string };
    clock: { nowIso(): string };
    fs?: Partial<StoreDeps>;
  },
) {
  const impl: StoreDeps = { ...defaultStoreDeps, ...deps.fs };
  const file = join(dataRoot, "shell", "bookmarks.json");

  async function list(): Promise<Outcome<BookmarkList>> {
    let raw: Uint8Array;
    try {
      raw = await impl.readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true, value: { state: "ok", bookmarks: [] } };
      }
      return { ok: false, reason: "unreadable" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return { ok: true, value: { state: "corrupt" } };
    }
    const result = fileSchema.safeParse(parsed);
    if (!result.success) return { ok: true, value: { state: "corrupt" } };
    return {
      ok: true,
      value: { state: "ok", bookmarks: result.data.bookmarks },
    };
  }

  // 읽고-바꾸고-쓰는 한 번이 다른 쓰기와 섞이지 않게 줄 세운다. 앞 쓰기가 실패해도 뒤는 돈다.
  let tail: Promise<unknown> = Promise.resolve();
  function mutate<T>(
    change: (
      bookmarks: Bookmark[],
    ) => Outcome<{ bookmarks: Bookmark[]; result: T }>,
  ): Promise<Outcome<T>> {
    const run = async (): Promise<Outcome<T>> => {
      const current = await list();
      if (!current.ok) return current;
      // corrupt이면 파일을 건드리지 않는다.
      if (current.value.state === "corrupt") {
        return { ok: false, reason: "corrupt" };
      }
      const next = change(current.value.bookmarks);
      if (!next.ok) return next;
      const written = await writeFileAtomic(
        file,
        JSON.stringify({ version: 1, bookmarks: next.value.bookmarks }),
        impl,
      );
      if (!written.ok) return { ok: false, reason: "unwritable" };
      return { ok: true, value: next.value.result };
    };
    const promise = tail.then(run);
    tail = promise.catch(() => {});
    return promise;
  }

  return {
    list,
    add(input: {
      title: string;
      url: string;
      favicon?: string;
    }): Promise<Outcome<Bookmark>> {
      const title = checkTitle(input.title);
      if (title === undefined) {
        return Promise.resolve({ ok: false, reason: "title" });
      }
      const url = checkUrl(input.url);
      if (url === undefined) {
        return Promise.resolve({ ok: false, reason: "url" });
      }
      return mutate((bookmarks) => {
        if (bookmarks.some((b) => b.url === url)) {
          return { ok: false, reason: "duplicate" };
        }
        if (bookmarks.length >= BOOKMARK_MAX) {
          return { ok: false, reason: "limit" };
        }
        const bookmark: Bookmark = {
          id: deps.ids.bookmark(),
          title,
          url,
          created_at: deps.clock.nowIso(),
          // 규칙에 맞지 않는 favicon은 버리고 bookmark만 더한다.
          ...(favicon.safeParse(input.favicon).success
            ? { favicon: input.favicon }
            : {}),
        };
        return {
          ok: true,
          value: { bookmarks: [...bookmarks, bookmark], result: bookmark },
        };
      });
    },
    update(input: {
      id: string;
      title?: string;
      url?: string;
    }): Promise<Outcome<Bookmark>> {
      const title =
        input.title === undefined ? undefined : checkTitle(input.title);
      if (input.title !== undefined && title === undefined) {
        return Promise.resolve({ ok: false, reason: "title" });
      }
      const url = input.url === undefined ? undefined : checkUrl(input.url);
      if (input.url !== undefined && url === undefined) {
        return Promise.resolve({ ok: false, reason: "url" });
      }
      return mutate((bookmarks) => {
        const found = bookmarks.find((b) => b.id === input.id);
        if (found === undefined) return { ok: false, reason: "missing" };
        if (
          url !== undefined &&
          bookmarks.some((b) => b.id !== found.id && b.url === url)
        ) {
          return { ok: false, reason: "duplicate" };
        }
        const updated: Bookmark = {
          ...found,
          title: title ?? found.title,
          url: url ?? found.url,
        };
        return {
          ok: true,
          value: {
            bookmarks: bookmarks.map((b) => (b.id === found.id ? updated : b)),
            result: updated,
          },
        };
      });
    },
    remove(id: string): Promise<Outcome<null>> {
      return mutate((bookmarks) => {
        if (!bookmarks.some((b) => b.id === id)) {
          return { ok: false, reason: "missing" };
        }
        return {
          ok: true,
          value: {
            bookmarks: bookmarks.filter((b) => b.id !== id),
            result: null,
          },
        };
      });
    },
  };
}
