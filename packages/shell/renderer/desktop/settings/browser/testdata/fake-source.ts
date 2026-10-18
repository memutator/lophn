// Browser 항목의 가짜 통로. shell을 부르지 않고 부른 일을 calls에 둔다.
import type { Bookmark } from "../../../../../ipc/browser.ts";
import type { BrowserSettingsSource, SourceResult } from "../source.ts";

interface FakeBrowserSettingsOptions {
  /** 지우기가 거절되는 code. 없으면 지워진다. */
  clearCode?: string;
  /** 처음 목록. 없으면 화면 확인용 대표 셋이다. */
  bookmarks?: Bookmark[];
  /** 파일이 깨진 상태. */
  corrupt?: boolean;
  /** 고치기와 지우기가 거절되는 BookmarkReason. 없으면 된다. */
  writeCode?: string;
}

const sample = (n: number, title: string, url: string): Bookmark => ({
  id: `bookmark-${n}`,
  title,
  url,
  created_at: "2026-01-01T00:00:00.000Z",
});

export function fakeBrowserSettings(options: FakeBrowserSettingsOptions = {}) {
  const calls: unknown[][] = [];
  let list = options.bookmarks ?? [
    sample(1, "Deno", "https://deno.com/"),
    sample(2, "MDN Web Docs", "https://developer.mozilla.org/"),
    sample(3, "Example", "https://example.com/"),
  ];
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const refused = (code: string): Promise<SourceResult<null>> =>
    Promise.resolve({ ok: false, code });
  const source: BrowserSettingsSource = {
    clearData() {
      calls.push(["clearData"]);
      return Promise.resolve(
        options.clearCode
          ? { ok: false, code: options.clearCode }
          : { ok: true, value: null },
      );
    },
    bookmarks() {
      calls.push(["bookmarks"]);
      return Promise.resolve({
        ok: true,
        value: options.corrupt
          ? { state: "corrupt" }
          : { state: "ok", bookmarks: list },
      });
    },
    updateBookmark(input) {
      calls.push(["updateBookmark", input]);
      if (options.writeCode) return refused(options.writeCode);
      const title = input.title.trim();
      if (title === "") return refused("title");
      if (!/^https?:\/\//.test(input.url)) return refused("url");
      if (list.some((b) => b.id !== input.id && b.url === input.url)) {
        return refused("duplicate");
      }
      list = list.map((b) =>
        b.id === input.id ? { ...b, title, url: input.url } : b
      );
      changed();
      return Promise.resolve({ ok: true, value: null });
    },
    removeBookmark(id) {
      calls.push(["removeBookmark", id]);
      if (options.writeCode) return refused(options.writeCode);
      list = list.filter((b) => b.id !== id);
      changed();
      return Promise.resolve({ ok: true, value: null });
    },
    watchBookmarks(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { source, calls };
}
