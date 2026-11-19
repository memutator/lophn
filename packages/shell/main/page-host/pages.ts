// page host의 탭마다 offscreen page 하나. display가 없으면 offscreen 창만 page를 그린다(숨긴 창과 창에 붙지 않은 view는
// screenshot과 screencast가 끝나지 않는다). headless에서 offscreen 창은 1x1이라 첫 주소 전에 크기 emulation을 걸어 둔다.
import { BrowserWindow, type Event as ElectronEvent } from "electron";

import type { BrowserTabState } from "../../../protocol/lophn-agent/host-queue.ts";
import { createPages } from "../browser/agent/electron-page.ts";
import type { Page } from "../browser/agent/page.ts";
import { decideNavigation } from "../browser/navigation.ts";
import { BROWSER_PARTITION } from "../browser/session.ts";

// 창 하나의 agent page 상한(renderer `MAX_AGENT_PAGES`)과 같다. page host에는 창이 없어 이 기계 전체의 상한이다.
const MAX_PAGES = 12;
const SIZE = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
// 보는 쪽 없이 움직이는 page의 그리기 비용과 멀리서 보기 frame의 상한이다(stream은 10 fps로 보낸다).
const FRAME_RATE = 10;

type NavigationEvent = ElectronEvent & { url: string; isMainFrame: boolean };

export type PageHostPages = ReturnType<typeof createPageHostPages>;

export function createPageHostPages(
  /** 탭의 url·title·loading이 바뀌었거나 page가 닫혔다(죽었다). */
  report: (tab: string, state: BrowserTabState | "closed") => void,
  /** 열린 page 수가 바뀔 때마다 부른다. */
  onCount?: (count: number) => void,
) {
  const pageOf = createPages();
  // 넣은 차례가 쓴 차례다. 쓰면 맨 뒤로 옮긴다.
  const windows = new Map<string, BrowserWindow>();

  async function open(tab: string, address: string): Promise<void> {
    if (windows.has(tab)) return touch(tab);
    while (windows.size >= MAX_PAGES) {
      const [oldest] = windows.keys();
      close(oldest!);
    }
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        partition: BROWSER_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    windows.set(tab, window);
    onCount?.(windows.size);
    window.once("closed", () => {
      if (windows.get(tab) === window) {
        windows.delete(tab);
        onCount?.(windows.size);
      }
      report(tab, "closed");
    });
    const contents = window.webContents;
    contents.setFrameRate(FRAME_RATE);

    const guard = (event: NavigationEvent) => {
      const decision = decideNavigation({
        url: event.url,
        isMainFrame: event.isMainFrame,
      });
      if (!decision.allow) event.preventDefault();
    };
    // Electron 44에서 main frame은 will-frame-navigate가 먼저 오고 거기서 막으면 will-navigate는 오지 않는다.
    contents.on("will-frame-navigate", guard);
    contents.on("will-redirect", guard);
    // popup을 둘 자리가 없다.
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("render-process-gone", () => close(tab));

    // 아무것도 load하지 않은 page에 크기 emulation을 보내면 process가 죽는다(headless, 확인함). 빈 page를 먼저 연다.
    // owner는 page가 사는 동안 떼지 않는다(떼면 override가 풀린다).
    const page = pageOf(contents);
    const emulate = () => page.send("Emulation.setDeviceMetricsOverride", SIZE);
    try {
      await contents.loadURL("about:blank");
      page.attach("emulation");
      await emulate();
    } catch (thrown) {
      close(tab);
      throw thrown;
    }
    if (contents.isDestroyed()) return;
    // 이동한 뒤에도 screenshot과 innerWidth는 override를 따르지만 screencast는 1x1 창을 찍고 멈춘다. main frame이 옮길 때마다 다시 건다.
    contents.on("did-navigate", () => void emulate().catch(() => {}));

    let last = "";
    const changed = () => {
      if (contents.isDestroyed()) return;
      const state = {
        url: contents.getURL(),
        title: contents.getTitle(),
        loading: contents.isLoading(),
      };
      const text = JSON.stringify(state);
      if (text === last) return;
      last = text;
      report(tab, state);
    };
    contents.on("did-start-loading", changed);
    contents.on("did-stop-loading", changed);
    contents.on("did-navigate", changed);
    contents.on("did-navigate-in-page", changed);
    contents.on("page-title-updated", changed);

    // 첫 주소도 page 안의 이동과 같은 규칙을 지난다. 못 지나면 빈 page다.
    const first = decideNavigation({ url: address, isMainFrame: true }).allow
      ? address
      : "about:blank";
    // load 실패는 page의 상태(url·loading)로 보인다.
    contents.loadURL(first).catch(() => {});
  }

  function close(tab: string): void {
    const window = windows.get(tab);
    if (windows.delete(tab)) onCount?.(windows.size);
    if (window !== undefined && !window.isDestroyed()) window.destroy();
  }

  function touch(tab: string): void {
    const window = windows.get(tab);
    if (window === undefined) return;
    windows.delete(tab);
    windows.set(tab, window);
  }

  return {
    open,
    close,
    touch,
    count: () => windows.size,
    page(tab: string): Page | undefined {
      const window = windows.get(tab);
      return window === undefined || window.isDestroyed()
        ? undefined
        : pageOf(window.webContents);
    },
  };
}
