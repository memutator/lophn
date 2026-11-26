// 프로젝트 앱 패널 탭과 세션 앱 카드가 같이 쓰는 창 통로. view는 shell
// preload의 view 통로로 main이 열고, 이름·판은 core의 app read로 읽는다. 앱 UI 코드와 앱 scheme
// 자원은 여기 오지 않는다. 창마다 하나를 provider로 둔다.

import { t } from "@lophn/i18n";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type {
  AppKeyDeclaration,
  TraySize,
} from "../../../protocol/apps/declaration/mod.ts";
import type { AppViewOpen, LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { useScopeMachine } from "../desktop/machines/context.tsx";
import type { MachineRef } from "../desktop/machines/scope.tsx";
import type { IconReader } from "../parts/icon-upload/icon-reader.ts";
import type { WorkspaceRef } from "../shell/desk-model.ts";
import { appWorkspaceForScope } from "./machine-app-source.ts";

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

/** 앱 선언의 화면 하나. */
interface AppScreen {
  readonly key: string;
  readonly label: string;
  readonly places: readonly AppViewOpen["place"][];
  /** 선언한 tray popup 크기(px. 숫자면 고정, 범위면 내용에 맞춘다). */
  readonly tray?: TraySize;
}

export interface AppScreens {
  readonly app: string;
  readonly name: string;
  /** 지금 채택된 판. view를 열 때 이 판에 고정한다(main은 live에서 판 없이 열지 않는다). */
  readonly release: string;
  readonly screens: readonly AppScreen[];
  /** 앱이 선언한 key. Settings › Keyboard 줄이 되고, 앱 page가 맞출 글이 된다. */
  readonly keys?: readonly AppKeyDeclaration[];
}

/** 앱과 화면을 함께 가리키는 label. 화면 이름이 앱 이름과 같으면 앱 이름만 돌려준다. */
export function appScreenLabel(app: string, screen: string): string {
  const appName = app.trim();
  const screenName = screen.trim();
  if (
    screenName.length === 0 ||
    appName.toLowerCase() === screenName.toLowerCase()
  ) {
    return appName || screenName;
  }
  return t("app-panel.label.screen", { app: appName, screen: screenName });
}

export type ScreensRead =
  | { readonly ok: true; readonly value: readonly AppScreens[] }
  | { readonly ok: false };

export interface AppViewsDeps {
  views: LophnShellViewsApi;
  app(app: string): Promise<AppRead>;
  /**
   * 프로젝트 탭에 고를 수 있는 앱과 그 화면 선언(apps/tools). 없으면 앱 패널 열기를 두지
   * 않는다.
   */
  screens?(): Promise<ScreensRead>;
  /**
   * 사람이 앱 실행을 켠다(app detail의 Run과 같은 길). 앱이 꺼져 있어 화면을 못 여는 자리의 [Turn on]이 쓴다. 다른 기계는
   * 없다(App details는 이 컴퓨터만).
   */
  enableRun?(app: string): Promise<{ readonly ok: boolean }>;
  /** 앱 icon 이미지의 data URL(apps/icon). 사람이 올린 것이 선언한 것보다 앞선다. 없거나 읽지 못하면 undefined다. */
  icon?: IconReader;
}

const AppViewsContext = createContext<AppViewsDeps | null>(null);

export const AppViewsProvider = AppViewsContext.Provider;

/** 없으면(테스트, overlay, preload 없는 창) 앱 view 자리는 그릴 수 없다는 안내만 둔다. */
export function useAppViews(): AppViewsDeps | null {
  return useContext(AppViewsContext);
}

interface ScopedAppWorkspace {
  readonly machine: MachineRef;
  readonly value: AppViewOpen["workspace"];
}

const AppWorkspaceContext = createContext<ScopedAppWorkspace | null>(null);

/**
 * 창이 보이는 workspace. 앱 화면이 열릴 때 `usePlace().workspace`로 받는다. 창 밖(전역 float)은
 * provider가 없어 workspace 없이 연다. folders는 project의 등록 폴더 path 목록이고, identity는 project의
 * 기계를 넘는 id, formerIdentities는 그 project가 전에 가졌던 id다(둘은 project에만 싣는다).
 * 다른 기계의 workspace를 보는 동안 이 컴퓨터의 앱(tray·오른쪽 sidebar·로컬 app panel)은 기계가 달라 workspace 없이 연다.
 */
export function AppWorkspaceProvider(props: {
  workspace: WorkspaceRef;
  identity: string | null;
  formerIdentities: readonly string[];
  folders: readonly string[];
  children: ReactNode;
}) {
  const { workspace, identity } = props;
  const machine: MachineRef = workspace.machine ?? null;
  const id = workspace.kind === "home" ? "home" : workspace.id;
  const folders = JSON.stringify(props.folders);
  const former = JSON.stringify(props.formerIdentities);
  // project를 아직 읽지 못한 창은 그 project의 id를 모른다. 틀린 key로 쓰지 않게 workspace 없이 연다.
  const entry = useMemo<ScopedAppWorkspace>(
    () => ({
      machine,
      value:
        workspace.kind === "project" && identity === null
          ? undefined
          : workspace.kind === "project"
            ? {
                kind: "project",
                id,
                identity,
                formerIdentities: JSON.parse(former) as string[],
                folders: JSON.parse(folders) as string[],
              }
            : {
                kind: workspace.kind,
                id,
                folders: JSON.parse(folders) as string[],
              },
    }),
    [machine, workspace.kind, id, identity, former, folders],
  );
  return (
    <AppWorkspaceContext.Provider value={entry}>
      {props.children}
    </AppWorkspaceContext.Provider>
  );
}

export function useAppWorkspace(): AppViewOpen["workspace"] {
  return appWorkspaceForScope(
    useContext(AppWorkspaceContext),
    useScopeMachine(),
  );
}

interface AppGetValue {
  app: {
    name: string;
    active_release: string | null;
    status: "active" | "archived";
  };
}

/** core `apps.get`(protocol App)에서 크롬과 판 고정이 읽는 field만 옮긴다. */
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
        code:
          code === "not_found" || code === "forbidden"
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

interface DeclarationValue {
  screens: {
    key: string;
    label: string;
    places: AppViewOpen["place"][];
    tray?: TraySize;
  }[];
  keys?: AppKeyDeclaration[];
}

/** 목록을 끝까지 읽는 page 상한. 넘으면 모은 앱까지만 고를 수 있다. */
const APP_PAGE_LIMIT = 10;

/**
 * 프로젝트 탭에 고를 수 있는 앱과 그 화면 선언. 활성 앱 목록(core `apps.list`)에서
 * 판이 채택된 앱의 선언(`apps.tools`)을 읽는다. 하나를 읽지 못한 앱은 없는 앱과 같게 빠지고,
 * 목록을 읽지 못하면 실패다.
 */
export function coreAppScreens(
  core: CoreSource,
): NonNullable<AppViewsDeps["screens"]> {
  return async () => {
    const listed: AppListValue["apps"] = [];
    let cursor: string | undefined;
    for (let page = 0; page < APP_PAGE_LIMIT; page += 1) {
      const reply = await core.call({
        kind: "read",
        resource: "apps",
        method: "list",
        body:
          cursor === undefined
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
        method: "tools",
        body: { app: app.id },
      });
      if (!reply.ok) continue;
      const declaration = reply.value as DeclarationValue;
      found.push({
        app: app.id,
        name: app.name,
        release: app.active_release,
        screens: declaration.screens.map((screen) => ({
          key: screen.key,
          label: screen.label,
          places: screen.places,
          ...(screen.tray === undefined ? {} : { tray: screen.tray }),
        })),
        keys: declaration.keys ?? [],
      });
    }
    return { ok: true, value: found };
  };
}
