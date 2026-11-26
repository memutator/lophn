// 고른 appearance를 모든 문서에 닿게 한다. 값(`shell.*` 설정)과 theme(`shell.themes`의 항목)은 core 설정의 사본
// (ctx.settings)에서 읽는다. 사본이 바뀌면 다시 검사해서 nativeTheme.themeSource를 맞추고(overlay·보호 입력 창·앱 view의
// prefers-color-scheme), token을 덮어쓰는 CSS를 lophn 문서(shell 화면, overlay, 보호 입력 창, 앱 view)의 webContents에
// insertCSS한다. 값이 바뀌면 옛 CSS를 지우고 새로 넣고, 문서를 새로 읽으면(dom-ready) 지금 CSS를 다시 넣는다.
// 그래서 Settings 화면이 바꾸든 `lophn settings set`이나 agent가 바꾸든 같은 길로 적용된다.
// 앱 view 문서에는 lophn 화면의 언어도 `<html data-lophn-locale>`로 적는다. `@lophn/app-ui`가 그 언어로 자기 문구를 고른다.
import { join } from "node:path";
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
  THEMES_FOLDER_CHANNEL,
  THEMES_SETTING_KEY,
} from "../../../ipc/appearance.ts";
import {
  type Appearance,
  APPEARANCE_DEFAULTS,
  appearanceCss,
  parseAppearance,
} from "../../../../design/appearance.ts";
import { type ColorTheme, loadThemes } from "../../../../design/themes.ts";
import { ARTIFACT_SCHEME } from "../../artifact/session.ts";
import { artifactDocumentCss } from "../../artifact/theme-css.ts";
import {
  readInitialAppearance,
  shellBackgroundColor,
} from "../core/initial-appearance.ts";
import { checkCaller } from "../ipc-guard.ts";
import type { Registered, ShellContext } from "./context.ts";

// devtools 같은 lophn 것이 아닌 문서에는 넣지 않는다.
const LOPHN_DOCUMENT = /^lophn-(?:shell|app|artifact):\/\//;
// `@lophn/app-ui`의 locale.ts가 읽는 속성. 값은 고정 상수라 script에 그대로 넣어도 된다.
const STAMP_LOCALE = `document.documentElement.setAttribute("data-lophn-locale", ${JSON.stringify(LOPHN_LOCALE)})`;

export function register(ctx: ShellContext): Registered {
  const { ipc, overlays, settings } = ctx;
  // core가 아직 뜨는 동안("lophn is getting ready.")에도 마지막 저장 theme·모드를 바로 쓴다.
  // core가 붙어 `settings/list`를 받으면 refresh()가 같은 경로로 이어받는다.
  const initial = readInitialAppearance(ctx.dataRoot);
  let currentAppearance: Appearance = initial.appearance;
  let currentThemes: readonly ColorTheme[] = initial.themes;
  let css = initial.css;
  nativeTheme.themeSource = currentAppearance.mode;
  ctx.appearanceBackground = () =>
    shellBackgroundColor(
      currentAppearance,
      currentThemes,
      nativeTheme.shouldUseDarkColors,
    );
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

  // 설정이나 theme이 바뀌면 CSS를 다시 만들어 열린 문서에 넣는다. core가 받은 값이라도 CSS에 넣기 전에 다시
  // 검사한다(앱 화면에 들어가는 CSS의 경계다). 목록 밖 값이 있으면 지금 모양을 둔다.
  function refresh(): void {
    const appearance: Appearance | undefined = parseAppearance(
      Object.fromEntries(
        Object.keys(APPEARANCE_DEFAULTS).map((field) => [
          field,
          settings.get(`shell.${field}`),
        ]),
      ),
    );
    if (appearance === undefined) return;
    currentAppearance = appearance;
    nativeTheme.themeSource = appearance.mode;
    const themes = loadThemes(
      (settings.folder(THEMES_SETTING_KEY)?.entries ?? []).map((entry) => ({
        id: entry.id,
        text: JSON.stringify(entry.value),
      })),
    );
    currentThemes = themes.list;
    const next = appearanceCss(appearance, themes.list);
    if (next === css) return;
    css = next;
    for (const contents of allContents.getAllWebContents()) {
      apply(contents, false);
    }
  }
  const unwatch = settings.watch(refresh);

  const fromDesktop = (event: Parameters<typeof checkCaller>[1]) => {
    const caller = checkCaller(overlays.overlayRegistry(), event);
    return caller.ok && caller.value.origin.host === "desktop";
  };

  // folder는 core가 만들고 지켜본다. 이름은 core가 알려 준 것을 쓴다.
  ipc.handle(THEMES_FOLDER_CHANNEL, (event) => {
    const folder = settings.folder(THEMES_SETTING_KEY)?.folder;
    if (fromDesktop(event) && folder !== undefined) {
      void shell.openPath(join(ctx.dataRoot, folder));
    }
  });

  return {
    stop() {
      ipc.removeHandler(THEMES_FOLDER_CHANNEL);
      unwatch();
      app.off("web-contents-created", onCreated);
    },
  };
}
