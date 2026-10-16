// 앱 화면 annotate mode. renderer 요청과 앱 view 페이지의 메시지를 받아 고른 목록을 쥐고, 보내기는
// screenshot을 만들어 core `annotation.upload_screenshot`·`annotation.send`로 간다.
import { nativeImage } from "electron";

import { ANNOTATE_STATE_CHANNEL } from "../../../ipc/annotation.ts";
import {
  registerAnnotateIpc,
  removeAnnotateIpc,
} from "../../app-frame/annotate.ts";
import { nativeCropAndFit } from "../../app-frame/capture.ts";
import type { AppViews } from "./app-views.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext, views: AppViews): Registered {
  const { core, overlays, windowRef, windowOfRef } = ctx;
  registerAnnotateIpc(ctx.ipc, {
    registry: overlays.overlayRegistry(),
    windowOf: (sender) => {
      const window = ctx.shellWindowOf(sender);
      return window === undefined ? undefined : windowRef(window);
    },
    owner: (view_session) => views.appFrame.owner(view_session),
    view: (view_session) => views.appFrame.annotateView(view_session),
    senderView: (contentsId) => views.appFrame.senderAnnotateView(contentsId),
    pushState(ref, state) {
      const window = windowOfRef(ref);
      if (window !== undefined && !window.webContents.isDestroyed()) {
        window.webContents.send(ANNOTATE_STATE_CHANNEL, state);
      }
    },
    core: {
      call: ctx.coreInternal,
      upload(resource, method, body, bytes) {
        const session = core.session();
        return session === null
          ? Promise.resolve({
            ok: false,
            error: { code: "unavailable", message: "core is not ready" },
          })
          : session.upload(resource, method, body, bytes);
      },
    },
    cropAndFit: nativeCropAndFit(nativeImage),
  });
  return { stop: () => removeAnnotateIpc(ctx.ipc) };
}
