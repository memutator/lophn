// createViewVisibility가 받는 frame. browser 탭의 view_session이면 browser로, 아니면 앱 view
// registry로 보낸다. 위치·숨김·폐기만 갈라 보내고 열기·reopen·project는 앱 것이다.
import type { ViewBounds } from "../app-frame/view-model.ts";
import type { AppFrameService } from "../app-frame/registry.ts";
import type { BrowserViews } from "./registry.ts";

export type BrowserFrame = Pick<
  BrowserViews,
  "has" | "owner" | "setBounds" | "hide" | "close"
>;

export function routeFrame(
  appFrame: AppFrameService,
  browser: BrowserFrame,
): Pick<
  AppFrameService,
  "open" | "setBounds" | "hide" | "close" | "reopen" | "owner" | "setProject"
> {
  return {
    open: appFrame.open,
    reopen: appFrame.reopen,
    setProject: appFrame.setProject,
    owner: (view_session) =>
      browser.owner(view_session) ?? appFrame.owner(view_session),
    // visibility가 창 본문과 교차한 ViewBounds만 넘긴다.
    setBounds: (view_session, bounds) =>
      browser.has(view_session)
        ? browser.setBounds(view_session, bounds as ViewBounds)
        : appFrame.setBounds(view_session, bounds),
    hide: (view_session) =>
      browser.has(view_session)
        ? browser.hide(view_session)
        : appFrame.hide(view_session),
    close(view_session) {
      if (browser.has(view_session)) browser.close(view_session);
      else appFrame.close(view_session);
    },
  };
}
