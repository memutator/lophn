// 앱 탭의 현재 보기 상태(shell/workspace#R11). 요청 창의 프로젝트 앱 패널 view에서 앱·release·
// mode·screen 참조와 view generation만 꺼내 current-view.ts의 `ViewRegistry.appView`로 준다.
// 앱 화면의 상세 상태·힌트·주석은 앱이 선언한 command(apps/agent-context)로만 읽고 쓰므로 여기에는
// DOM·screenshot·화면 글을 담을 자리가 없다. 세션 카드와 앱 공간 view는 탭이 아니라 고르지 않는다.
import type { ViewListing } from "../app-frame/view-model.ts";
import type { ViewRegistry } from "./current-view.ts";

export interface AppViewSource {
  /** 그 창에 열린 앱 view 참조(app-frame registry의 `views`). */
  views(window: string): readonly ViewListing[];
}

/**
 * 요청 창의 앱 패널 view 참조. 같은 앱·screen의 패널이 여럿이면 가장 늦게 바뀐 view다.
 * release가 없는 preview(준비 전 bundle)는 참조할 판이 없어 null이고, 조립은 그것을 생략으로
 * 남긴다.
 */
export function appViewContext(
  source: AppViewSource,
  window: string,
): Pick<ViewRegistry, "appView"> {
  return {
    appView(app, surface) {
      let found: ViewListing | undefined;
      for (const view of source.views(window)) {
        if (
          view.size !== "panel" || view.app !== app ||
          view.screen !== surface || view.release === null
        ) continue;
        if (found === undefined || view.generation > found.generation) {
          found = view;
        }
      }
      if (found === undefined || found.release === null) return null;
      return {
        release: found.release,
        mode: found.mode,
        view_generation: found.generation,
      };
    },
  };
}
