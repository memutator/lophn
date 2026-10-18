import type { LophnBrowserApi } from "../../../../ipc/browser.ts";
import type { BrowserSettingsSource } from "./source.ts";

/** desktop 창 preload의 `window.lophnBrowser`를 잇는다. 없거나 거절되면 unavailable이다. */
export function windowBrowserSettings(): BrowserSettingsSource {
  const api = (globalThis as { lophnBrowser?: LophnBrowserApi }).lophnBrowser;
  // bookmark 거절은 Error.message가 BookmarkReason이다.
  async function call<T>(run: (api: LophnBrowserApi) => Promise<T>) {
    if (api === undefined) return { ok: false, code: "unavailable" } as const;
    try {
      return { ok: true, value: await run(api) } as const;
    } catch (error) {
      const code = error instanceof Error ? error.message : "unavailable";
      return { ok: false, code } as const;
    }
  }
  return {
    clearData: () => call((api) => api.clearData().then(() => null)),
    bookmarks: () => call((api) => api.bookmarks.list()),
    updateBookmark: (input) =>
      call((api) => api.bookmarks.update(input).then(() => null)),
    removeBookmark: (id) =>
      call((api) => api.bookmarks.remove({ id }).then(() => null)),
    watchBookmarks: (listener) =>
      api === undefined ? () => {} : api.bookmarks.subscribe(listener),
  };
}
