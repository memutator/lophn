import {
  APPEARANCE_CHANNEL,
  type AppearanceApi,
  THEMES_CHANGED_CHANNEL,
  THEMES_CHANNEL,
  THEMES_FOLDER_CHANNEL,
} from "../ipc/appearance.ts";
import type { Themes } from "../../design/themes.ts";
import type { BrowserTransport } from "./browser-api.ts";

// 값만 보낸다. 실패해도 화면의 data-theme은 이미 바뀌었으므로 조용히 둔다.
export function createAppearanceApi(
  transport: BrowserTransport,
): AppearanceApi {
  return Object.freeze({
    set(appearance) {
      void transport.invoke(APPEARANCE_CHANNEL, appearance).catch(() => {});
    },
    themes: () => transport.invoke(THEMES_CHANNEL) as Promise<Themes>,
    onThemesChanged(listener) {
      const callback = () => listener();
      transport.on(THEMES_CHANGED_CHANNEL, callback);
      return () => transport.removeListener(THEMES_CHANGED_CHANNEL, callback);
    },
    openThemesFolder() {
      void transport.invoke(THEMES_FOLDER_CHANNEL).catch(() => {});
    },
  } satisfies AppearanceApi);
}
