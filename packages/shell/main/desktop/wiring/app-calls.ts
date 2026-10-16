// 앱 호출과 앱 preload IPC. 호출은 core의 `app.call_api`로 가고 고정 blueprint는 `app.app_api`로 읽는다.
import { createAppCall } from "../../app-frame/app-call.ts";
import { registerAppIpc, removeAppIpc } from "../../app-frame/app-ipc.ts";
import { createBlueprintSource } from "../../app-frame/blueprint-source.ts";
import type { AppViews } from "./app-views.ts";
import type { Registered, ShellContext } from "./context.ts";

/** 뒤 영역이 쓰는 앱 호출. */
type AppCalls = Registered & {
  appCall: ReturnType<typeof createAppCall>;
};

// 앱 preload 통로. 신원은 IPC sender view에서만 정한다. view 오류의 collector 전달은
// 아직 core 통로가 없어 unsent다.
export function register(ctx: ShellContext, views: AppViews): AppCalls {
  const appCall = createAppCall({
    blueprint: createBlueprintSource((app, release) =>
      ctx.coreInternal("read", "apps", "app_api", { app, release })
    ),
    call: ctx.coreInternal,
  });
  registerAppIpc(ctx.ipc, {
    view: (contentsId) => views.appFrame.senderView(contentsId),
    call: (view, input) => appCall.call(view, input),
    openExternal: (view, input) => views.externalLinks.open(view, input),
    viewError: (view, input) => views.viewErrors.observe(view, input),
  });
  return { appCall, stop: () => removeAppIpc(ctx.ipc) };
}
