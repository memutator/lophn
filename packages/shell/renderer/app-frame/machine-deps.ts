// 기계마다의 앱 화면 통로. 범위의 묶음(`desktop/machines/data.ts`)이 이 함수로 짓는다.
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { MachineRef } from "../desktop/machines/scope.tsx";
import type { AppDetailSource } from "./app-detail/source.ts";
import { coreAppIcon } from "./app-icon.tsx";
import {
  type AppViewsDeps,
  coreAppRead,
  coreAppScreens,
} from "./app-views.tsx";

/**
 * 앱 패널 탭과 세션 앱 카드의 view 통로. view는 desktop 창 preload에만 있고 이 컴퓨터의 shell main이 붙인다. 다른 기계의 앱
 * 화면은 아직 없다(null).
 */
export function machineAppViews(
  machine: MachineRef,
  core: CoreSource,
  views: LophnShellViewsApi | undefined,
  appDetail: AppDetailSource | undefined,
): AppViewsDeps | null {
  if (machine !== null || views === undefined) return null;
  return {
    views,
    app: coreAppRead(core),
    screens: coreAppScreens(core),
    // app detail source가 없는 창에서는 켜지 못한다.
    enableRun: (app) =>
      appDetail?.setRun(app, true) ?? Promise.resolve({ ok: false }),
    icon: coreAppIcon(core),
  };
}
