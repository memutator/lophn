// artifact view의 `<webview>` guest를 Electron에 잇는다. 붙이기 판정(partition·preload·
// webPreferences)은 browser/webview-guest.ts가 하고, 이 모듈은 이미 붙은 guest 하나에 탐색
// 규칙·새 창 거절·활동 신호·건강 감시·캡처를 건다. preload는 표시하기 층뿐이다.
import {
  type Event as ElectronEvent,
  type NativeImage,
  type WebContents,
} from "electron";

import type { GuestContents } from "../app-frame/view-model.ts";
import type { HeadlessMode } from "../desktop/headless.ts";
import { decideArtifactNavigation } from "./navigation.ts";
import type {
  ArtifactContents,
  ArtifactHooks,
  ArtifactViewHost,
} from "./registry.ts";

interface ElectronArtifactViewsInput {
  packaged: boolean;
  headless: HeadlessMode;
}

type NavigationEvent = ElectronEvent & { url: string; isMainFrame: boolean };

// 취소(ERR_ABORTED). 새 navigation이 앞선 것을 대신할 때 나오고 실패가 아니다.
const LOAD_ABORTED = -3;

export function electronArtifactViews(
  input: ElectronArtifactViewsInput,
): ArtifactViewHost {
  return {
    guest(guest, hooks: ArtifactHooks) {
      const contents = guest as GuestContents & WebContents;
      const id = contents.id;
      // headless(offscreen)에서는 capturePage가 실패한다. 개발 확인에서는 마지막 paint를 쓴다.
      let painted: NativeImage | undefined;

      // 입력 없이 page가 스스로 보낸 이동은 조용히 버린다. Electron 44에서 main frame은
      // will-frame-navigate가 먼저 오고, 거기서 막으면 will-navigate는 오지 않는다. 그래서
      // will-navigate는 듣지 않고 will-frame-navigate에서 알린다(external은 main frame에만 선다).
      const guard = (event: NavigationEvent) => {
        const decision = decideArtifactNavigation({
          url: event.url,
          isMainFrame: event.isMainFrame,
          host: hooks.host,
        });
        if (decision.allow) return;
        event.preventDefault();
        if (
          decision.external &&
          event.isMainFrame &&
          hooks.activation.freshPerson(id)
        ) {
          hooks.openLink(event.url);
        }
      };
      contents.on("will-redirect", guard);
      contents.on("will-frame-navigate", guard);
      contents.setWindowOpenHandler((details) => {
        const decision = decideArtifactNavigation({
          url: details.url,
          isMainFrame: true,
          host: hooks.host,
        });
        if (
          !decision.allow &&
          decision.external &&
          hooks.activation.freshPerson(id)
        ) {
          hooks.openLink(details.url);
        }
        return { action: "deny" };
      });
      contents.on("will-attach-webview", (event) => event.preventDefault());
      if (input.packaged) {
        contents.on("devtools-opened", () => contents.closeDevTools());
      }

      // before-input-event는 keyboard만 준다. mouse는 input-event로 듣는다.
      contents.on("input-event", (_event, event) => {
        if (event.type === "mouseDown") hooks.activation.mark(id);
        else if (
          (event.type === "keyDown" || event.type === "rawKeyDown") &&
          !event.modifiers?.includes("isautorepeat")
        )
          hooks.activation.mark(id);
      });

      const changed = () => hooks.onChange();
      contents.on("page-title-updated", changed);
      contents.on("did-start-loading", changed);
      contents.on("did-stop-loading", changed);
      contents.on("did-fail-load", (_event, code) => {
        if (code !== LOAD_ABORTED) changed();
      });
      contents.on("render-process-gone", () => {
        painted = undefined;
        hooks.onHealth("gone");
      });
      contents.on("unresponsive", () => hooks.onHealth("unresponsive"));
      contents.on("responsive", () => hooks.onHealth("responsive"));
      contents.once("destroyed", () => {
        hooks.activation.forget(id);
        hooks.onDestroyed();
      });
      if (input.headless.headless) {
        contents.on("paint", (_event, _dirty, image) => {
          painted = image;
        });
      }

      return {
        id,
        title: () => (contents.isDestroyed() ? "" : contents.getTitle()),
        loading: () => !contents.isDestroyed() && contents.isLoading(),
        reload: () => {
          if (!contents.isDestroyed()) contents.reloadIgnoringCache();
        },
        pageUrl: () =>
          contents.isDestroyed() ? null : contents.getURL() || null,
        send(channel, payload) {
          if (!contents.isDestroyed()) contents.send(channel, payload);
        },
        async capture() {
          if (contents.isDestroyed() || contents.isCrashed()) {
            throw new Error("view is gone");
          }
          const image = input.headless.headless
            ? painted
            : await contents.capturePage();
          if (image === undefined || image.isEmpty()) {
            throw new Error("nothing painted yet");
          }
          return new Uint8Array(image.toPNG());
        },
      } satisfies ArtifactContents;
    },
  };
}
