// 프로젝트 앱 패널 탭과 세션 앱 카드가 같이 쓰는 창 통로. view는 shell
// preload의 view 통로로 main이 열고, 이름·판은 core의 app read로 읽는다. 앱 UI 코드와 앱 scheme
// 자원은 여기 오지 않는다. 창마다 하나를 provider로 둔다.
import { createContext, useContext } from "react";

import type { CoreSource } from "../desktop/connection/connection.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";

/** 앱 등록에서 view 크롬과 판 고정이 쓰는 것만. */
interface AppFacts {
  readonly name: string;
  /** 지금 채택된 판. 아직 없으면 null이다. */
  readonly release: string | null;
  readonly archived: boolean;
}

export type AppRead =
  | { readonly ok: true; readonly value: AppFacts }
  /** not_found는 없는 앱과 범위 밖 앱을 같게 답한다. */
  | { readonly ok: false; readonly code: "not_found" | "unavailable" };

/** blueprint가 선언한 화면 하나. */
interface AppScreen {
  readonly key: string;
  readonly label: string;
  readonly sizes: readonly ("full" | "panel" | "card")[];
}

export interface AppScreens {
  readonly app: string;
  readonly name: string;
  readonly screens: readonly AppScreen[];
}

export type ScreensRead =
  | { readonly ok: true; readonly value: readonly AppScreens[] }
  | { readonly ok: false };

export interface AppViewsDeps {
  views: LophnShellViewsApi;
  app(app: string): Promise<AppRead>;
  /**
   * 프로젝트 탭에 고를 수 있는 앱과 그 화면 선언(apps/blueprint). 없으면 앱 패널 열기를 두지
   * 않는다.
   */
  screens?(): Promise<ScreensRead>;
  /** view에 묶인 [Report a problem]. 없으면 버튼을 잠근다. */
  report?(view_session: string): void;
}

const AppViewsContext = createContext<AppViewsDeps | null>(null);

export const AppViewsProvider = AppViewsContext.Provider;

/** 없으면(테스트, overlay, preload 없는 창) 앱 view 자리는 그릴 수 없다는 안내만 둔다. */
export function useAppViews(): AppViewsDeps | null {
  return useContext(AppViewsContext);
}

interface AppGetValue {
  app: {
    name: string;
    active_release: string | null;
    status: "active" | "archived";
  };
}

/** core `apps.get`(contracts App)에서 크롬과 판 고정이 읽는 field만 옮긴다. */
export function coreAppRead(core: CoreSource): AppViewsDeps["app"] {
  return async (app) => {
    const reply = await core.call({
      kind: "read",
      resource: "apps",
      method: "get",
      body: { app },
    });
    if (!reply.ok) {
      const code = reply.error?.code;
      return {
        ok: false,
        code: code === "not_found" || code === "forbidden"
          ? "not_found"
          : "unavailable",
      };
    }
    const value = (reply.value as AppGetValue).app;
    return {
      ok: true,
      value: {
        name: value.name,
        release: value.active_release,
        archived: value.status === "archived",
      },
    };
  };
}

interface AppListValue {
  apps: { id: string; name: string; active_release: string | null }[];
  next_cursor?: string | null;
}

interface BlueprintValue {
  screens: {
    key: string;
    label: string;
    sizes: ("full" | "panel" | "card")[];
  }[];
}

/** 목록을 끝까지 읽는 page 상한. 넘으면 모은 앱까지만 고를 수 있다. */
const APP_PAGE_LIMIT = 10;

/**
 * 프로젝트 탭에 고를 수 있는 앱과 그 화면 선언. 활성 앱 목록(core `apps.list`)에서
 * 판이 채택된 앱의 blueprint(`apps.blueprint`)를 읽는다. 하나를 읽지 못한 앱은 없는 앱과 같게 빠지고,
 * 목록을 읽지 못하면 실패다.
 */
export function coreAppScreens(core: CoreSource): NonNullable<
  AppViewsDeps["screens"]
> {
  return async () => {
    const listed: AppListValue["apps"] = [];
    let cursor: string | undefined;
    for (let page = 0; page < APP_PAGE_LIMIT; page += 1) {
      const reply = await core.call({
        kind: "read",
        resource: "apps",
        method: "list",
        body: cursor === undefined
          ? { status: "active" }
          : { status: "active", cursor },
      });
      if (!reply.ok) return { ok: false };
      const value = reply.value as AppListValue;
      listed.push(...value.apps);
      if (value.next_cursor === undefined || value.next_cursor === null) break;
      cursor = value.next_cursor;
    }
    const found: AppScreens[] = [];
    for (const app of listed) {
      if (app.active_release === null) continue;
      const reply = await core.call({
        kind: "read",
        resource: "apps",
        method: "blueprint",
        body: { app: app.id },
      });
      if (!reply.ok) continue;
      const blueprint = reply.value as BlueprintValue;
      found.push({
        app: app.id,
        name: app.name,
        screens: blueprint.screens.map((screen) => ({
          key: screen.key,
          label: screen.label,
          sizes: screen.sizes,
        })),
      });
    }
    return { ok: true, value: found };
  };
}
