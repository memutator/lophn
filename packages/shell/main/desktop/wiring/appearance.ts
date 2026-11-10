// 사람이 고른 appearance를 모든 문서에 닿게 한다. desktop 창 본문이 값을 보내면 검사해서
// nativeTheme.themeSource를 맞추고(overlay·보호 입력 창·앱 view의 prefers-color-scheme), token을 덮어쓰는 CSS를
// lophn 문서(shell 화면, overlay, 보호 입력 창, 앱 view)의 webContents에 insertCSS한다. 값이 바뀌면 옛 CSS를
// 지우고 새로 넣고, 문서를 새로 읽으면(dom-ready) 지금 CSS를 다시 넣는다. 앱 view 문서에는 lophn 화면의 언어도
// `<html data-lophn-locale>`로 적는다. `@lophn/app-ui`가 그 언어로 자기 문구를 고른다.
// theme file(`<data root>/themes/`)도 여기서 읽고 지켜본다. 바뀌면 CSS를 다시 만들고 desktop 창에 알린다.
import {
  app,
  nativeTheme,
  shell,
  type WebContents,
  webContents as allContents,
} from "electron";

import { LOPHN_LOCALE } from "../../../../design/i18n/format.ts";
import { APP_SCHEME } from "../../app-frame/network-policy.ts";
import {
  APPEARANCE_CHANNEL,
  THEMES_CHANGED_CHANNEL,
  THEMES_CHANNEL,
  THEMES_FOLDER_CHANNEL,
} from "../../../ipc/appearance.ts";
import {
  type Appearance,
  appearanceCss,
  parseAppearance,
} from "../../../../design/appearance.ts";
import { loadThemes, type Themes } from "../../../../design/themes.ts";
import { themeFolder } from "../theme-files.ts";
import { ARTIFACT_SCHEME } from "../../artifact/session.ts";
import { artifactDocumentCss } from "../../artifact/theme-css.ts";
import { checkCaller } from "../ipc-guard.ts";
import type { Registered, ShellContext } from "./context.ts";

// devtools 같은 lophn 것이 아닌 문서에는 넣지 않는다.
const LOPHN_DOCUMENT = /^lophn-(?:shell|app|artifact):\/\//;
// `@lophn/app-ui`의 locale.ts가 읽는 속성. 값은 고정 상수라 script에 그대로 넣어도 된다.
const STAMP_LOCALE = `document.documentElement.setAttribute("data-lophn-locale", ${JSON.stringify(LOPHN_LOCALE)})`;

export function register(ctx: ShellContext): Registered {
  const { ipc, overlays, windows } = ctx;
  let css = "";
  let chosen: Appearance | undefined;
  let themes: Themes = loadThemes([]);
  const folder = themeFolder(ctx.dataRoot);
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
      // artifact 문서에는 base token이 없어 css가 빈 글이어도 넣는다.
      const text = contents.getURL().startsWith(`${ARTIFACT_SCHEME}://`)
        ? artifactDocumentCss(css)
        : css;
      if (text === "" || contents.isDestroyed()) return;
      const key = await contents.insertCSS(text).catch(() => undefined);
      if (key !== undefined) inserted.set(contents, key);
    };
    queue.set(contents, (queue.get(contents) ?? Promise.resolve()).then(run));
  }

  // 문서를 새로 읽을 때마다 지금 CSS를 넣는다. 창·view가 나중에 생겨도 같다.
  const onCreated = (_event: unknown, contents: WebContents) => {
    contents.on("dom-ready", () => {
      apply(contents, true);
      if (contents.getURL().startsWith(`${APP_SCHEME}://`)) {
        void contents.executeJavaScript(STAMP_LOCALE).catch(() => {});
      }
    });
  };
  app.on("web-contents-created", onCreated);

  // 값이나 theme이 바뀌면 CSS를 다시 만들어 열린 문서에 넣는다.
  function refresh(): void {
    if (chosen === undefined) return;
    const next = appearanceCss(chosen, themes.list);
    if (next === css) return;
    css = next;
    for (const contents of allContents.getAllWebContents()) {
      apply(contents, false);
    }
  }

  const fromDesktop = (event: Parameters<typeof checkCaller>[1]) => {
    const caller = checkCaller(overlays.overlayRegistry(), event);
    return caller.ok && caller.value.origin.host === "desktop";
  };

  ipc.handle(APPEARANCE_CHANNEL, (event, input: unknown) => {
    if (!fromDesktop(event)) return;
    const appearance = parseAppearance(input);
    if (appearance === undefined) return;
    nativeTheme.themeSource = appearance.mode;
    chosen = appearance;
    refresh();
  });

  ipc.handle(THEMES_CHANNEL, (event) =>
    fromDesktop(event) ? themes : undefined,
  );
  ipc.handle(THEMES_FOLDER_CHANNEL, (event) => {
    if (fromDesktop(event)) void shell.openPath(folder.path);
  });

  const reload = async () => {
    themes = await folder.read();
    refresh();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(THEMES_CHANGED_CHANNEL);
      }
    }
  };
  void reload();
  const unwatch = folder.watch(() => void reload());

  return {
    stop() {
      ipc.removeHandler(APPEARANCE_CHANNEL);
      ipc.removeHandler(THEMES_CHANNEL);
      ipc.removeHandler(THEMES_FOLDER_CHANNEL);
      unwatch();
      app.off("web-contents-created", onCreated);
    },
  };
}
