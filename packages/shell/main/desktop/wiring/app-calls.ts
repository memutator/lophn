// 앱 호출과 앱 preload IPC. blueprint 읽기와 앱 connector는 앞 영역도 써서 context에 있다.
import { randomUUID } from "node:crypto";

import {
  canonicalInputHash,
  validateInput,
} from "../../../../protocol/apps/blueprint.ts";
import { createAppCall } from "../../app-frame/app-call.ts";
import { nodeInvoke } from "../../app-frame/app-invoke.ts";
import { registerAppIpc, removeAppIpc } from "../../app-frame/app-ipc.ts";
import { createBlueprintSource } from "../../app-frame/blueprint-source.ts";
import type { AppViews } from "./app-views.ts";
import type { Registered, ShellContext } from "./context.ts";

/** 뒤 영역이 쓰는 앱 호출. */
export type AppCalls = Registered & {
  appCall: ReturnType<typeof createAppCall>;
};

// 앱 preload 통로. 신원은 IPC sender view에서만 정한다. 고정 blueprint는 core의
// `/v1/apps/blueprint`를 읽는다. confirm command의 approval·proof와
// view 오류의 collector 전달 binding은 아직 core 통로가 없어 unavailable·unsent다.
export function register(ctx: ShellContext, views: AppViews): AppCalls {
  const appCall = createAppCall({
    connector: ctx.appConnector,
    blueprint: createBlueprintSource(ctx.readBlueprint),
    rules: { validate: validateInput, hash: canonicalInputHash },
    confirm: () =>
      Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "confirmation is not ready" },
      }),
    invoke: nodeInvoke,
    ids: { requestKey: () => randomUUID() },
    clock: { nowMs: () => Date.now() },
  });
  registerAppIpc(ctx.ipc, {
    view: (contentsId) => views.appFrame.senderView(contentsId),
    call: (view, input) => appCall.call(view, input),
    openExternal: (view, input) => views.externalLinks.open(view, input),
    viewError: (view, input) => views.viewErrors.observe(view, input),
  });
  return { appCall, stop: () => removeAppIpc(ctx.ipc) };
}
