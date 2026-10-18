import type { LophnBrowserApi } from "../../../../ipc/browser.ts";
import type { BrowserSettingsSource } from "./source.ts";

/** desktop 창 preload의 `window.lophnBrowser`를 잇는다. 없거나 거절되면 unavailable이다. */
export function windowBrowserSettings(): BrowserSettingsSource {
  const api = (globalThis as { lophnBrowser?: LophnBrowserApi }).lophnBrowser;
  return {
    async clearData() {
      if (api === undefined) return { ok: false, code: "unavailable" };
      try {
        await api.clearData();
        return { ok: true, value: null };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  };
}
