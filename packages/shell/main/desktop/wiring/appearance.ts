// 사람이 고른 appearance를 모든 문서에 닿게 한다. desktop 창 본문이 값을 보내면 검사해서
// nativeTheme.themeSource를 맞추고(overlay·보호 입력 창·앱 view의 prefers-color-scheme), token을 덮어쓰는 CSS를
// lophn 문서(shell 화면, overlay, 보호 입력 창, 앱 view)의 webContents에 insertCSS한다. 값이 바뀌면 옛 CSS를
// 지우고 새로 넣고, 문서를 새로 읽으면(dom-ready) 지금 CSS를 다시 넣는다.
import {
  app,
  nativeTheme,
  type WebContents,
  webContents as allContents,
} from "electron";

import { APPEARANCE_CHANNEL } from "../../../ipc/appearance.ts";
import {
  appearanceCss,
  parseAppearance,
} from "../../../../design/appearance.ts";
import { checkCaller } from "../ipc-guard.ts";
import type { Registered, ShellContext } from "./context.ts";

// devtools 같은 lophn 것이 아닌 문서에는 넣지 않는다.
const LOPHN_DOCUMENT = /^lophn-(?:shell|app):\/\//;

export function register(ctx: ShellContext): Registered {
  const { ipc, overlays } = ctx;
  let css = "";
  // contents마다 지금 문서에 넣은 CSS의 key. 넣고 지우는 일은 contents마다 차례로 한다.
  const inserted = new WeakMap<WebContents, string>();
  const queue = new WeakMap<WebContents, Promise<void>>();

  function apply(contents: WebContents, fresh: boolean): void {
    if (contents.isDestroyed() || !LOPHN_DOCUMENT.test(contents.getURL())) {
      return;
    }
    const run = async () => {
      const old = inserted.get(contents);
      inserted.delete(contents);
      // 새 문서에는 옛 key가 없다. 같은 문서에서 값이 바뀐 때만 지운다.
      if (old !== undefined && !fresh && !contents.isDestroyed()) {
        await contents.removeInsertedCSS(old).catch(() => {});
      }
      if (css === "" || contents.isDestroyed()) return;
      const key = await contents.insertCSS(css).catch(() => undefined);
      if (key !== undefined) inserted.set(contents, key);
    };
    queue.set(contents, (queue.get(contents) ?? Promise.resolve()).then(run));
  }

  // 문서를 새로 읽을 때마다 지금 CSS를 넣는다. 창·view가 나중에 생겨도 같다.
  const onCreated = (_event: unknown, contents: WebContents) => {
    contents.on("dom-ready", () => apply(contents, true));
  };
  app.on("web-contents-created", onCreated);

  ipc.handle(APPEARANCE_CHANNEL, (event, input: unknown) => {
    const caller = checkCaller(overlays.overlayRegistry(), event);
    if (!caller.ok || caller.value.origin.host !== "desktop") return;
    const appearance = parseAppearance(input);
    if (appearance === undefined) return;
    nativeTheme.themeSource = appearance.theme;
    const next = appearanceCss(appearance);
    if (next === css) return;
    css = next;
    for (const contents of allContents.getAllWebContents()) {
      apply(contents, false);
    }
  });

  return {
    stop() {
      ipc.removeHandler(APPEARANCE_CHANNEL);
      app.off("web-contents-created", onCreated);
    },
  };
}
