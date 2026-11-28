// 앱 호출과 앱 preload IPC. operation 호출은 core의 view 표(`app_views/call`)로 간다. 다른 기계의 view가 부른 것은 그 기계의
// core로만 가고(`views.caller`), 기기 목록에 없는 route는 그 기계가 거절한다.
import { createAppAgent } from "../../app-frame/app-agent.ts";
import { createAppAgents } from "../../app-frame/app-agents.ts";
import { createAppCall } from "../../app-frame/app-call.ts";
import { createAppMachines } from "../../app-frame/app-machines.ts";
import { createAppProjects } from "../../app-frame/app-projects.ts";
import { createAppSessions } from "../../app-frame/app-sessions.ts";
import { registerAppIpc, removeAppIpc } from "../../app-frame/app-ipc.ts";
import type { AppViews } from "./app-views.ts";
import type { Registered, ShellContext } from "./context.ts";

/** 뒤 영역이 쓰는 앱 호출. */
type AppCalls = Registered & {
  appCall: ReturnType<typeof createAppCall>;
  /** 알림 규칙이 앱 화면이 붙은 session을 쥔 view를 찾는 데 쓴다. */
  appSessions: Pick<ReturnType<typeof createAppAgent>, "viewsOf">;
};

// 앱 preload 통로. 신원은 IPC sender view에서만 정한다. view 오류는 viewErrors가 core를 거쳐 그 앱
// log에 쓴다.
export function register(ctx: ShellContext, views: AppViews): AppCalls {
  const appCall = createAppCall({
    call: views.caller,
    resume: (view_session) => views.appFrame.resume(view_session),
    rejected: (view, operation, error) =>
      void views.viewErrors.callRejected(view, operation, error),
  });
  const appAgent = createAppAgent({
    call: views.caller,
    watch: (machine, sessions) => views.watchSessions(machine, sessions),
    send: (view_session, channel, payload) => {
      const port = views.appFrame.annotateView(view_session);
      if (port === undefined) return false;
      port.send(channel, payload);
      return true;
    },
  });
  const appProjects = createAppProjects({ call: views.caller });
  const appMachines = createAppMachines({ call: views.caller });
  const appSessionsApi = createAppSessions({ call: views.caller });
  const appAgents = createAppAgents({ call: views.caller });
  // 앱 화면이 연 session의 ACP 갱신. worktree 변경은 core가 앱 event(`lophn`의 `worktree.changed`)로 낸다.
  ctx.relay.conditions.push({ types: ["AcpUpdated"] });
  ctx.relay.events.push((event) => {
    if (event.type === "AcpUpdated") appAgent.updated(event.payload, null);
  });
  // 다른 기계의 view가 붙은 session의 갱신(`app-views`가 그 기계에 건다). 그 기계에 묶인 view에만 간다.
  ctx.machines.onFrame((machine, message) => {
    if (message.kind !== "event") return;
    const event = message.event as { type?: unknown; payload?: unknown };
    if (event.type === "AcpUpdated") {
      appAgent.updated(
        event.payload as { session: string; update: unknown },
        machine,
      );
    }
  });
  views.onViewClosed((view_session) => appAgent.forget(view_session));
  registerAppIpc(ctx.ipc, {
    view: (contentsId) => views.appFrame.senderView(contentsId),
    call: (view, input) => appCall.call(view, input),
    openExternal: (view, input) => views.externalLinks.open(view, input),
    viewError: (view, input) => views.viewErrors.observe(view, input),
    agentOpen: (view, input) => appAgent.open(view, input),
    agentSnapshot: (view, input) => appAgent.snapshot(view, input),
    agentSend: (view, input) => appAgent.send(view, input),
    projectsList: (view) => appProjects.list(view),
    projectsWorktrees: (view, input) => appProjects.worktrees(view, input),
    machinesList: (view) => appMachines.list(view),
    sessionsList: (view, input) => appSessionsApi.list(view, input),
    sessionsStatus: (view, input) => appSessionsApi.status(view, input),
    sessionsStop: (view, input) => appSessionsApi.stop(view, input),
    agentsRun: (view, input) => appAgents.run(view, input),
  });
  return {
    appCall,
    appSessions: appAgent,
    stop: () => removeAppIpc(ctx.ipc),
  };
}
