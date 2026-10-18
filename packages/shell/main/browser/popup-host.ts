// browser contents(<webview> guest와 native popup)의 window.open을 받는다. 사용자 입력이 있었던
// 것만 연다. 크기 준 popup은 새 native view로 열고(Electron의 createWindow가 만든 contents를 그대로
// 쓰므로 window.opener가 남는다), 크기 없는 popup은 거절하고 renderer에 새 탭을 열라고 알린다
// (표준 Electron은 그 contents를 <webview>에 넣지 못해 opener가 끊긴다).
import type {
  BrowserWindowConstructorOptions,
  HandlerDetails,
  WebContents,
  WindowOpenHandlerResponse,
} from "electron";

import type { BrowserContents, BrowserHooks } from "./registry.ts";
import { decidePopup } from "./popup.ts";

interface PopupHostInput {
  openerId: number;
  hooks: BrowserHooks;
  /** Electron이 popup용으로 만든 contents를 view로 감싼다(hook도 건다). */
  adopt(popup: WebContents, hooks: BrowserHooks): BrowserContents;
  /** popup contents를 만들 때 쓰는 옵션. options.webPreferences를 그대로 믿지 않고 덮는다. */
  overrides: BrowserWindowConstructorOptions;
}

export function windowOpenHandler(
  input: PopupHostInput,
): (details: HandlerDetails) => WindowOpenHandlerResponse {
  const { hooks } = input;
  return (details) => {
    const activated = hooks.activation.fresh(input.openerId);
    const decision = decidePopup({
      url: details.url,
      features: details.features,
      activated,
    });
    if (decision.action === "deny") {
      if (decision.reason === "no-activation") hooks.popup.blocked();
      else if (decision.external && activated) hooks.openExternal(details.url);
      return { action: "deny" };
    }
    if (decision.placement.kind === "docked") {
      hooks.popup.tab(decision.url);
      return { action: "deny" };
    }
    return {
      action: "allow",
      // floated 탭이 된 popup은 opener 탭을 닫아도 남는다.
      outlivesOpener: true,
      overrideBrowserWindowOptions: input.overrides,
      createWindow(options) {
        // Electron은 createWindow에 늘 만들어 둔 contents를 준다. 옵션 type에는 빠져 있다.
        const popup = (options as { webContents?: WebContents }).webContents!;
        hooks.popup.open(
          decision.placement,
          (popupHooks) => input.adopt(popup, popupHooks),
        );
        return popup;
      },
    };
  };
}
