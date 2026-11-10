import {
  type AppearanceApi,
  THEMES_FOLDER_CHANNEL,
} from "../ipc/appearance.ts";
import type { BrowserTransport } from "./browser-api.ts";

export function createAppearanceApi(
  transport: BrowserTransport,
): AppearanceApi {
  return Object.freeze({
    openThemesFolder() {
      void transport.invoke(THEMES_FOLDER_CHANNEL).catch(() => {});
    },
  } satisfies AppearanceApi);
}
