// browser 탭이 쓰는 창 통로(window.lophnBrowser). desktop 창 preload에만 있어서 없으면 null이다.
// overlay 통로(window.lophnShell)도 같은 꼴이다. 있으면 toolbar menu를 overlay로 연다.
import { createContext, useContext } from "react";

import type { LophnBrowserApi } from "../../ipc/browser.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";

const BrowserApiContext = createContext<LophnBrowserApi | null>(null);
const BrowserOverlayContext = createContext<OverlayApi | null>(null);

export const BrowserApiProvider = BrowserApiContext.Provider;
export const BrowserOverlayProvider = BrowserOverlayContext.Provider;

export function useBrowserApi(): LophnBrowserApi | null {
  return useContext(BrowserApiContext);
}

export function useBrowserOverlay(): OverlayApi | null {
  return useContext(BrowserOverlayContext);
}
