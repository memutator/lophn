import type { LophnBrowserApi } from "../../../../ipc/browser.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { windowCoreSource } from "../../connection/connection.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import { LINK_DEFAULT, LINK_ROWS } from "./model.ts";
import type { BrowserSettingsSource, LinkValues } from "./source.ts";

/**
 * desktop 창 preload의 `window.lophnBrowser`를 잇는다. 없거나 거절되면 unavailable이다.
 * link 열 곳은 선언 설정이라 core를 부른다. entry가 core를 넘기지 않아도 되게 기본 인자로 얻는다.
 */
export function windowBrowserSettings(
  core: CoreSource = windowCoreSource(),
): BrowserSettingsSource {
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
    async links() {
      const read = await readEffective(
        core,
        LINK_ROWS.map((r) => r.settingKey),
      );
      if (!read.ok) return read;
      const values = {} as Record<string, string>;
      for (const row of LINK_ROWS) {
        const stored = read.value.get(row.settingKey);
        values[row.id] = row.options.some((o) => o.value === stored)
          ? stored as string
          : LINK_DEFAULT;
      }
      return { ok: true, value: values as LinkValues };
    },
    chooseLink: (id, value) => {
      const row = LINK_ROWS.find((r) => r.id === id)!;
      return chooseSetting(core, row.settingKey, value);
    },
    watchBookmarks: (listener) =>
      api === undefined ? () => {} : api.bookmarks.subscribe(listener),
  };
}
