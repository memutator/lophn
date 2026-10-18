// browser 탭이 쓰는 창 통로(window.lophnBrowser). desktop 창 preload에만 있어서 없으면 null이다.
import { createContext, useContext } from "react";

import type { LophnBrowserApi } from "../../ipc/browser.ts";

const BrowserApiContext = createContext<LophnBrowserApi | null>(null);

export const BrowserApiProvider = BrowserApiContext.Provider;

export function useBrowserApi(): LophnBrowserApi | null {
  return useContext(BrowserApiContext);
}
