// browser page의 DevTools를 담는 native view. <webview>는 DevTools를 담지 못하므로(frontend가 page에 붙지
// 않는다) 한 번도 load하지 않은 새 WebContentsView에 붙인다. 붙은 view는 project 창과 따로 뜬 창 사이를
// 옮겨도 끊기지 않는다. closeDevTools 뒤에는 같은 view로 다시 열 수 없어 닫을 때는 view를 부순다.
import { BrowserWindow, type WebContents, WebContentsView } from "electron";

import {
  type HeadlessMode,
  reveal,
  surfaceOptions,
} from "../desktop/headless.ts";
import { webPreferences } from "../desktop/security.ts";

export interface DevtoolsView {
  readonly view: WebContentsView;
  /** true면 따로 뜬 OS 창으로 옮기고, false면 그 창에서 떼어 창을 닫는다(project 창에는 placement가 붙인다). */
  toWindow(on: boolean, title: string): void;
  destroy(): void;
}

export function openDevtoolsView(input: {
  target: WebContents;
  packaged: boolean;
  headless: HeadlessMode;
  /** view나 page가 사라졌거나 사람이 따로 뜬 창을 닫았다. 한 번만 부른다. */
  onGone(): void;
}): DevtoolsView {
  const view = new WebContentsView(
    surfaceOptions(
      {
        webPreferences: { ...webPreferences(input.packaged), devTools: false },
      },
      input.headless,
    ),
  );
  const contents = view.webContents;
  let ended = false;
  let window: BrowserWindow | undefined;
  const gone = () => {
    if (ended) return;
    ended = true;
    input.onGone();
  };

  input.target.setDevToolsWebContents(contents);
  input.target.openDevTools();
  input.target.once("destroyed", gone);
  contents.once("destroyed", gone);
  contents.on("render-process-gone", gone);

  function fit(): void {
    if (window === undefined || window.isDestroyed()) return;
    const [width = 0, height = 0] = window.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  }

  function closeWindow(): void {
    const open = window;
    window = undefined;
    if (open === undefined || open.isDestroyed()) return;
    open.contentView.removeChildView(view);
    open.removeAllListeners("closed");
    open.close();
  }

  return {
    view,
    toWindow(on, title) {
      if (!on) {
        closeWindow();
        return;
      }
      if (window !== undefined && !window.isDestroyed()) return;
      const opened = new BrowserWindow(
        surfaceOptions(
          {
            width: 900,
            height: 640,
            title: `DevTools – ${title}`,
            autoHideMenuBar: true,
            webPreferences: webPreferences(input.packaged),
          },
          input.headless,
        ),
      );
      window = opened;
      opened.contentView.addChildView(view);
      fit();
      opened.on("resize", fit);
      // 사람이 닫은 창은 DevTools를 닫는 것이다.
      opened.on("closed", () => {
        window = undefined;
        gone();
      });
      reveal(opened, input.headless);
    },
    destroy() {
      ended = true;
      closeWindow();
      if (!contents.isDestroyed()) contents.close();
    },
  };
}
