// mock 모드의 앱 공간 통로. 운영 패널(app-detail)은 화면 테스트의 가짜 통로이고, 앱
// view는 main의 native view 대신 본문 위에 안내 상자를 올리는 가짜 통로다.
import { fakeDetail } from "../../app-frame/app-detail/testdata/fake-source.ts";
import type { AppDetailSource } from "../../app-frame/app-detail/source.ts";
import type {
  AppFrameViewState,
  LophnShellViewsApi,
} from "../../../ipc/app-frame.ts";
import type { AppViewsDeps } from "../../app-frame/app-views.tsx";
import { APP_BUDGET, APP_PLANNER } from "./ids.ts";

export function mockAppDetail(): AppDetailSource {
  return fakeDetail({
    names: { [APP_PLANNER]: "Meal planner", [APP_BUDGET]: "Grocery budget" },
  }).source;
}

/**
 * 가짜 앱 view. 열면 running으로 답하고, 화면이 bounds를 보내면 그 사각형에 안내 상자를 놓는다.
 * 앱 프로세스는 없고 아무 core·파일에도 닿지 않는다.
 */
export function mockViews(root?: HTMLElement): LophnShellViewsApi {
  let serial = 0;
  const boxes = new Map<string, HTMLElement>();
  const states = new Map<string, AppFrameViewState>();
  const listeners = new Set<(state: AppFrameViewState) => void>();
  return {
    openApp(input) {
      serial += 1;
      const session = `mock-view-${serial}`;
      const box = document.createElement("div");
      box.setAttribute("data-mock-app-view", input.app);
      box.style.cssText =
        "position:fixed;display:none;align-items:center;justify-content:center;" +
        "box-sizing:border-box;background:var(--color-surface-base);" +
        "color:var(--color-text-muted);font:14px var(--font-sans, sans-serif);z-index:1";
      box.textContent = `App view (${input.size}, ${input.screen}) is not drawn in mock mode`;
      (root ?? document.body).append(box);
      boxes.set(session, box);
      const state: AppFrameViewState = {
        view_session: session,
        app: input.app,
        release: input.release ?? null,
        mode: input.mode,
        screen: input.screen,
        size: input.size,
        connectionState: "running" as const,
      };
      states.set(session, state);
      return Promise.resolve(state);
    },
    setViewBounds({ view_session, bounds, layer = 0 }) {
      const box = boxes.get(view_session);
      if (box !== undefined) {
        box.style.display = "flex";
        // layer 1.. 은 floats 층(--z-sticky = 10)보다 위다. 진짜 native view는 DOM 위에 늘 그려진다.
        box.style.zIndex = String(layer === 0 ? 1 : 10 + layer);
        box.style.left = `${bounds.x}px`;
        box.style.top = `${bounds.y}px`;
        box.style.width = `${bounds.width}px`;
        box.style.height = `${bounds.height}px`;
      }
      return Promise.resolve({ generation: 1 });
    },
    setViewsHidden({ view_sessions }) {
      for (const session of view_sessions) {
        const box = boxes.get(session);
        if (box !== undefined) box.style.display = "none";
      }
      return Promise.resolve({ generation: 1 });
    },
    closeView({ view_session }) {
      boxes.get(view_session)?.remove();
      boxes.delete(view_session);
      states.delete(view_session);
      return Promise.resolve();
    },
    reopenView: () => Promise.reject(new Error("conflict")),
    subscribeViewState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 프로젝트 탭의 앱 패널 고르기와 view 크롬이 읽는 앱 사실. */
export function mockAppViews(views: LophnShellViewsApi): AppViewsDeps {
  const apps = {
    [APP_BUDGET]: "Grocery budget",
    [APP_PLANNER]: "Meal planner",
  } as const;
  return {
    views,
    app: (app) => {
      const name = (apps as Record<string, string>)[app];
      return Promise.resolve(
        name === undefined
          ? { ok: false, code: "not_found" as const }
          : {
              ok: true as const,
              value: {
                name,
                release: "rel_01h455vb4pex5v6nkc6gd5fd01",
                archived: false,
              },
            },
      );
    },
    screens: () =>
      Promise.resolve({
        ok: true as const,
        value: Object.entries(apps).map(([app, name]) => ({
          app,
          name,
          screens: [
            {
              key: "home",
              label: "Home",
              sizes: ["full", "panel", "card"] as const,
            },
          ],
        })),
      }),
  };
}
