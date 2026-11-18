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
 * 앱 패널 탭, 앱 화면 탭, 세션 앱 카드의 view 통로. view는 desktop 창 preload에만 있고 이 컴퓨터의 shell main이 붙인다.
 * 다른 기계면 이름·판·화면 목록·icon은 그 기계의 core가 주고, view는 그 기계를 실어 연다(main이 그 기계의 core에 묶는다).
 * 앱 켜기([Turn on])는 App details의 일이라 이 컴퓨터만 있다.
 */
export function machineAppViews(
  machine: MachineRef,
  core: CoreSource,
  views: LophnShellViewsApi | undefined,
  appDetail: AppDetailSource | undefined,
): AppViewsDeps | null {
  if (views === undefined) return null;
  const reads = {
    app: coreAppRead(core),
    screens: coreAppScreens(core),
    icon: coreAppIcon(core),
  };
  if (machine !== null) {
    return {
      ...reads,
      views: {
        ...views,
        openApp: (input) => views.openApp({ ...input, machine }),
      },
    };
  }
  return {
    ...reads,
    views,
    // app detail source가 없는 창에서는 켜지 못한다.
    enableRun: (app) =>
      appDetail?.setRun(app, true) ?? Promise.resolve({ ok: false }),
  };
}
