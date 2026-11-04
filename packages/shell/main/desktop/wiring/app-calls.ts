// 앱 호출과 앱 preload IPC. 호출은 core의 `apps/call_tool`로 가고 고정 선언은 `apps/tools`로 읽는다.
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../../base/mod.ts";
import { createAppAgent } from "../../app-frame/app-agent.ts";
import { createAppCall } from "../../app-frame/app-call.ts";
import { registerAppIpc, removeAppIpc } from "../../app-frame/app-ipc.ts";
import { createDeclarationSource } from "../../app-frame/declaration-source.ts";
import type { AppViews } from "./app-views.ts";
import type { Registered, ShellContext } from "./context.ts";

/** 뒤 영역이 쓰는 앱 호출. */
type AppCalls = Registered & {
  appCall: ReturnType<typeof createAppCall>;
};

// 앱 preload 통로. 신원은 IPC sender view에서만 정한다. view 오류는 viewErrors가 core를 거쳐 그 앱
// log에 쓴다.
export function register(ctx: ShellContext, views: AppViews): AppCalls {
  const appCall = createAppCall({
    declaration: createDeclarationSource((app, release) =>
      ctx.coreInternal("read", "apps", "tools", { app, release }),
    ),
    call: ctx.coreInternal,
  });
  const appAgent = createAppAgent({
    call: ctx.coreInternal,
    ids: createIdSource({ clock: systemClock, random: cryptoRandom }),
    send: (view_session, channel, payload) => {
      const port = views.appFrame.annotateView(view_session);
      if (port === undefined) return false;
      port.send(channel, payload);
      return true;
    },
  });
  // 앱 화면이 연 session의 ACP 갱신. 어느 view로 보낼지는 appAgent가 고른다.
  ctx.relay.conditions.push({ types: ["AcpUpdated"] });
  ctx.relay.events.push((event) => {
    if (event.type === "AcpUpdated") appAgent.updated(event.payload);
  });
  registerAppIpc(ctx.ipc, {
    view: (contentsId) => views.appFrame.senderView(contentsId),
    call: (view, input) => appCall.call(view, input),
    openExternal: (view, input) => views.externalLinks.open(view, input),
    viewError: (view, input) => views.viewErrors.observe(view, input),
    agentOpen: (view, input) => appAgent.open(view, input),
    agentSnapshot: (view, input) => appAgent.snapshot(view, input),
    agentSend: (view, input) => appAgent.send(view, input),
  });
  return { appCall, stop: () => removeAppIpc(ctx.ipc) };
}
