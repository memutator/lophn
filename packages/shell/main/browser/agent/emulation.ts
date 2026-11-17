// 사람이 preview 탭에서 고른 기기를 그 탭의 page에 건다: 크기·DPR, touch, user agent를 CDP `Emulation.*`로 정한다.
// debugger는 driver와 같은 page(`Page.attach`의 owner)로 같이 쓴다. 앱 live view에는 걸지 않는다(`pageOf`가 preview만 고른다).
import type { EmulationDevice } from "../../../ipc/surface.ts";
import { type Page, type PageLookup, pageOf } from "./page.ts";

// 기기 OS마다 고정된 user agent 하나씩이다. 사이트가 모바일 화면으로 가르는 데 쓰는 것이라 버전은 중요하지 않다.
const AGENTS = {
  ios: {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    platform: "iPhone",
  },
  android: {
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    platform: "Linux armv81",
  },
} as const;

/** devtools는 DevTools가 열려 있어(또는 다른 debugger가 붙어) 걸 수 없다는 뜻이다. */
export type EmulationResult =
  | { ok: true }
  | { ok: false; reason: "devtools" | "unavailable" };

export interface Emulation {
  /** device가 null이면 푼다. */
  apply(
    viewSession: string,
    device: EmulationDevice | null,
  ): Promise<EmulationResult>;
}

// touch와 user agent는 page를 새로 load해야 page의 script에 보인다(DevTools의 기기 모드도 그렇다). preview는 fixture data라 잃을 것이 없다.
// CDP `Page.reload`는 webview guest가 아니라 그것을 품은 shell 창을 다시 load해서(실험으로 확인) page 안에서 부른다.
const reload = (page: Page) =>
  page.send("Runtime.evaluate", { expression: "location.reload()" }).then(
    () => {},
    () => {},
  );

export function createEmulation(lookup: PageLookup): Emulation {
  // 건 page(webContents id). 풀 때 건 적 없는 page에는 붙지 않는다.
  const applied = new Set<number>();
  // DevTools를 지켜보는 page. page마다 한 번만 듣는다.
  const watched = new Set<number>();
  // 건 뒤 사람이 DevTools를 열면 emulation이 풀린다. 건 것으로 남겨 두면 다시 고를 때 이미 붙은 줄 알고 실패하고,
  // driver가 기기를 걸린 것으로 알린다. 떼어 상태를 맞춘다.
  const watch = (page: Page) => {
    if (watched.has(page.id)) return;
    watched.add(page.id);
    page.subscribe({
      cdp() {},
      detached() {},
      devtoolsOpened() {
        if (applied.delete(page.id)) page.detach("emulation");
      },
    });
  };
  return {
    async apply(viewSession, device) {
      const page = pageOf(lookup, "preview", viewSession);
      if (page === undefined || page.isDestroyed()) {
        return { ok: false, reason: "unavailable" };
      }
      if (device === null) {
        if (!applied.delete(page.id)) return { ok: true };
        try {
          await page.send("Emulation.clearDeviceMetricsOverride");
          await page.send("Emulation.setTouchEmulationEnabled", {
            enabled: false,
          });
          await page.send("Emulation.setEmitTouchEventsForMouse", {
            enabled: false,
          });
          await page.send("Emulation.setUserAgentOverride", { userAgent: "" });
          await reload(page);
        } catch {
          // debugger가 이미 떨어졌으면 건 것도 같이 사라졌다.
        }
        page.detach("emulation");
        return { ok: true };
      }
      if (page.isDevToolsOpened()) return { ok: false, reason: "devtools" };
      try {
        page.attach("emulation");
      } catch {
        return { ok: false, reason: "devtools" };
      }
      applied.add(page.id);
      watch(page);
      const agent = AGENTS[device.os];
      try {
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: device.width,
          height: device.height,
          deviceScaleFactor: device.dpr,
          mobile: true,
        });
        await page.send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 5,
        });
        await page.send("Emulation.setEmitTouchEventsForMouse", {
          enabled: true,
          configuration: "mobile",
        });
        await page.send("Emulation.setUserAgentOverride", agent);
        await reload(page);
      } catch {
        applied.delete(page.id);
        page.detach("emulation");
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true };
    },
  };
}
