// createViewVisibility가 받는 frame. browser 탭의 view_session이면 browser로, artifact view면
// artifact로, 아니면 앱 view registry로 보낸다. 위치·숨김·폐기·창 옮기기만 갈라 보내고 열기·reopen은 앱 것이다.
import type { ViewBounds } from "../app-frame/view-model.ts";
import type { AppFrameService } from "../app-frame/registry.ts";
import type { ArtifactViews } from "../artifact/registry.ts";
import type { BrowserViews } from "./registry.ts";

export type BrowserFrame = Pick<
  BrowserViews,
  "has" | "owner" | "setBounds" | "hide" | "close" | "move"
>;

export type ArtifactFrame = Pick<
  ArtifactViews,
  "has" | "owner" | "setBounds" | "hide" | "close" | "move"
>;

export function routeFrame(
  appFrame: AppFrameService,
  browser: BrowserFrame,
  artifact: ArtifactFrame,
): Pick<
  AppFrameService,
  "open" | "setBounds" | "hide" | "close" | "reopen" | "owner" | "move"
> {
  return {
    open: appFrame.open,
    reopen: appFrame.reopen,
    owner: (view_session) =>
      browser.owner(view_session) ??
      artifact.owner(view_session) ??
      appFrame.owner(view_session),
    // visibility가 창 본문과 교차한 ViewBounds만 넘긴다.
    setBounds(view_session, bounds, layer = 0) {
      if (browser.has(view_session)) {
        return browser.setBounds(view_session, bounds as ViewBounds, layer);
      }
      if (artifact.has(view_session)) {
        return artifact.setBounds(view_session, bounds as ViewBounds, layer);
      }
      return appFrame.setBounds(view_session, bounds, layer);
    },
    hide(view_session) {
      if (browser.has(view_session)) return browser.hide(view_session);
      if (artifact.has(view_session)) return artifact.hide(view_session);
      return appFrame.hide(view_session);
    },
    move(view_session, from, to) {
      if (browser.has(view_session)) {
        return browser.move(view_session, from, to);
      }
      if (artifact.has(view_session)) {
        return artifact.move(view_session, from, to);
      }
      return appFrame.move(view_session, from, to);
    },
    close(view_session) {
      if (browser.has(view_session)) browser.close(view_session);
      else if (artifact.has(view_session)) artifact.close(view_session);
      else appFrame.close(view_session);
    },
  };
}
