// bookmark 목록을 읽고 바꾸는 hook. 다른 창이 바꾸면 subscribe로 다시 읽는다.
import { useEffect, useState } from "react";
import { t } from "@lophn/i18n";

import type {
  Bookmark,
  BookmarkAdd,
  BookmarkList,
  BookmarkUpdate,
} from "../../ipc/browser.ts";
import { useBrowserApi } from "./browser-api.tsx";

type Read = { state: "loading" } | { state: "unavailable" } | BookmarkList;

export interface Bookmarks {
  state: "loading" | "ok" | "corrupt" | "unavailable";
  bookmarks: readonly Bookmark[];
  /** 거절이면 Error.message가 BookmarkReason이다. `bookmarkReasonText`로 문장을 얻는다. */
  add(input: BookmarkAdd): Promise<Bookmark>;
  update(input: BookmarkUpdate): Promise<Bookmark>;
  remove(id: string): Promise<void>;
}

const NONE: readonly Bookmark[] = [];

export function useBookmarks(): Bookmarks {
  const api = useBrowserApi();
  const [read, setRead] = useState<Read>({ state: "loading" });
  useEffect(() => {
    if (api === null) return;
    let alive = true;
    const load = () =>
      api.bookmarks.list().then(
        (list) => alive && setRead(list),
        () => alive && setRead({ state: "unavailable" }),
      );
    void load();
    const off = api.bookmarks.subscribe(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, [api]);

  const unavailable = () => Promise.reject(new Error("unavailable"));
  return {
    state: api === null ? "unavailable" : read.state,
    bookmarks: read.state === "ok" ? read.bookmarks : NONE,
    add: (input) => api?.bookmarks.add(input) ?? unavailable(),
    update: (input) => api?.bookmarks.update(input) ?? unavailable(),
    remove: (id) => api?.bookmarks.remove({ id }) ?? unavailable(),
  };
}

/** 거절한 Error를 사람이 읽을 문장으로 바꾼다. */
export function bookmarkReasonText(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "url":
      return t("settings.error.bookmark-url");
    case "title":
      return t("settings.error.bookmark-title");
    case "duplicate":
      return t("settings.error.bookmark-duplicate");
    case "limit":
      return t("browser.error.bookmark-limit");
    default:
      return t("settings.error.bookmark-failed");
  }
}

/** bookmark 제목이 없을 때 쓰는 이름: url의 host, 그것도 없으면 url. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
