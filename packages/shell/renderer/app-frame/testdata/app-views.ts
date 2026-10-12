// 앱 패널 탭·세션 카드 화면 테스트의 가짜 창 통로. view 열기·bounds·숨김·폐기 요청과 core app
// read를 기록한다. happy-dom은 배치를 하지 않아 가장 가까운 data-rect 조상의 사각형을 쓴다.
import { act } from "react";

import type {
  AppFrameViewState,
  AppViewOpen,
  LophnShellViewsApi,
  ViewBounds,
} from "../../../ipc/app-frame.ts";
import type {
  AppFacts,
  AppRead,
  AppScreens,
  AppViewsDeps,
} from "../app-views.tsx";

export const APP_A = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
export const APP_B = "app_01j9yyyyyyyyyyyyyyyyyyyyyy";
export const REL_1 = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
export const REL_2 = "rel_01j9zzzzzzzzzzzzzzzzzzzzz2";

export type ViewCall =
  | ["open", AppViewOpen]
  | ["bounds", string, ViewBounds]
  | ["hide", ...string[]]
  | ["close", string]
  | ["reopen", string];

export interface FakeAppViews {
  deps: AppViewsDeps;
  calls: ViewCall[];
  reports: string[];
  apps: Map<string, AppRead>;
  /** 다음 열기를 이 code로 거절한다. */
  refuseNext(code: string): void;
  push(state: AppFrameViewState): void;
  opened(): AppViewOpen[];
}

export function fakeAppViews(
  options: { screens?: readonly AppScreens[] } = {},
): FakeAppViews {
  const calls: ViewCall[] = [];
  const reports: string[] = [];
  const listeners = new Set<(state: AppFrameViewState) => void>();
  const facts = (name: string, release: string | null): AppRead => ({
    ok: true,
    value: { name, release, archived: false } satisfies AppFacts,
  });
  const apps = new Map<string, AppRead>([
    [APP_A, facts("Orders", REL_1)],
    [APP_B, facts("Calendar", REL_1)],
  ]);
  let refusal: string | undefined;
  let serial = 0;
  const views: LophnShellViewsApi = {
    openApp(input) {
      calls.push(["open", input]);
      if (refusal !== undefined) {
        const code = refusal;
        refusal = undefined;
        return Promise.reject(new Error(code));
      }
      return Promise.resolve({
        view_session: `view-${++serial}`,
        app: input.app,
        release: input.release ?? null,
        mode: input.mode,
        screen: input.screen,
        size: input.size,
        connectionState: "running",
      });
    },
    setViewBounds(input) {
      calls.push(["bounds", input.view_session, input.bounds]);
      return Promise.resolve({ generation: 1 });
    },
    setViewsHidden(input) {
      calls.push(["hide", ...input.view_sessions]);
      return Promise.resolve({ generation: 1 });
    },
    closeView(input) {
      calls.push(["close", input.view_session]);
      return Promise.resolve();
    },
    reopenView(input) {
      calls.push(["reopen", input.view_session]);
      return Promise.reject(new Error("conflict"));
    },
    subscribeViewState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const deps: AppViewsDeps = {
    views,
    app: (app) =>
      Promise.resolve(apps.get(app) ?? { ok: false, code: "not_found" }),
    report: (view_session) => reports.push(view_session),
    ...(options.screens === undefined ? {} : {
      screens: () => Promise.resolve({ ok: true, value: options.screens! }),
    }),
  };
  return {
    deps,
    calls,
    reports,
    apps,
    refuseNext(code) {
      refusal = code;
    },
    push(state) {
      for (const listener of [...listeners]) listener(state);
    },
    opened: () => calls.flatMap((call) => call[0] === "open" ? [call[1]] : []),
  };
}

export function withLayout<T>(run: () => Promise<T>): Promise<T> {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    const host = this.closest("[data-rect]");
    const [x, y, width, height] = (host?.getAttribute("data-rect") ?? "0 0 0 0")
      .split(" ").map(Number) as [number, number, number, number];
    return {
      x,
      y,
      left: x,
      top: y,
      width,
      height,
      right: x + width,
      bottom: y + height,
      toJSON() {},
    } as DOMRect;
  };
  return run().finally(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
  });
}

/** promise와 animation frame 몇 번을 흘린다. */
export async function frames(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}
