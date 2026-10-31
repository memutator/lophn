// mock 모드의 앱 공간 통로. 운영 패널(app-detail)은 화면 테스트의 가짜 통로이고, 앱
// 화면은 main의 view 대신 창의 <webview> 그릇이 그린다. mock 창에는 앱 page가 없으므로 state의 src는
// about:blank이고, webviewTag가 없는 환경에서는 그릇이 빈 자리(div)를 그린다.
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

/** 가짜 앱 view. 열면 running으로 답하고 state를 민다. 앱 프로세스는 없고 아무 core·파일에도 닿지 않는다. */
export function mockViews(): LophnShellViewsApi {
  let serial = 0;
  return {
    openApp(input) {
      serial += 1;
      const session = `mock-view-${serial}`;
      const state: AppFrameViewState = {
        view_session: session,
        app: input.app,
        release: input.release ?? null,
        mode: input.mode,
        screen: input.screen,
        size: input.size,
        src: "about:blank",
        connectionState: "running" as const,
      };
      return Promise.resolve(state);
    },
    // 앱 화면은 <webview> 그릇이 그리므로 bounds·숨기기는 쓰지 않는다.
    setViewBounds: () => Promise.resolve({ generation: 1 }),
    setViewsHidden: () => Promise.resolve({ generation: 1 }),
    closeView: () => Promise.resolve(),
    reopenView: () => Promise.reject(new Error("conflict")),
    subscribeViewState: () => () => {},
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
