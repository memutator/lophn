// 앱 view의 preload IPC를 main service에 잇는다. 매 IPC마다 sender가 registry의 살아 있는 앱
// view이고 그 main frame이 자기 앱 주소(같은 screen)인지 본다. 페이지는 자기가 어느 앱인지 모른다.
// 신원은 sender view에서 main이 정한다. 앱 view가 아닌 sender는 어느 통로도 쓰지 못한다. 앱이 부른 것은 그 view의
// 기계(`BoundView.machine`)의 core로만 간다.
import {
  APP_AGENT_OPEN_CHANNEL,
  APP_AGENT_SEND_CHANNEL,
  APP_AGENT_SNAPSHOT_CHANNEL,
} from "../../ipc/app-agent.ts";
import {
  APP_CALL_OPERATION_CHANNEL,
  APP_OPEN_EXTERNAL_CHANNEL,
  APP_VIEW_ERROR_CHANNEL,
  type AppReply,
} from "../../ipc/app.ts";
import { APP_AGENTS_CHANNEL } from "../../ipc/app-agents.ts";
import { APP_PROJECTS_LIST_CHANNEL } from "../../ipc/app-projects.ts";
import {
  APP_SESSIONS_LIST_CHANNEL,
  APP_SESSIONS_STATUS_CHANNEL,
  APP_SESSIONS_STOP_CHANNEL,
} from "../../ipc/app-sessions.ts";
import type { CallerFrame, IpcEvent } from "../desktop/ipc-guard.ts";
import type { CallOutcome } from "./app-call.ts";
import { parseAppUrl } from "./app-protocol.ts";
import type { BoundView } from "./registry.ts";
import { appHostLabel } from "./session-policy.ts";

interface AppIpcHost {
  handle(
    channel: string,
    listener: (event: unknown, input: unknown) => Promise<unknown>,
  ): void;
  on(channel: string, listener: (event: unknown, input: unknown) => void): void;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): void;
}

interface AppIpcDeps {
  /** webContents id의 지금 view(registry.senderView). */
  view(contentsId: number): BoundView | undefined;
  call(view: BoundView, input: unknown): Promise<CallOutcome<unknown>>;
  openExternal(view: BoundView, input: unknown): Promise<CallOutcome<null>>;
  viewError(view: BoundView, input: unknown): Promise<void>;
  agentOpen(view: BoundView, input: unknown): Promise<CallOutcome<unknown>>;
  agentSnapshot(view: BoundView, input: unknown): Promise<CallOutcome<unknown>>;
  agentSend(view: BoundView, input: unknown): Promise<CallOutcome<unknown>>;
  projectsList(view: BoundView): Promise<CallOutcome<unknown>>;
  sessionsList(view: BoundView, input: unknown): Promise<CallOutcome<unknown>>;
  sessionsStatus(
    view: BoundView,
    input: unknown,
  ): Promise<CallOutcome<unknown>>;
  sessionsStop(view: BoundView, input: unknown): Promise<CallOutcome<unknown>>;
  agentsRun(view: BoundView, input: unknown): Promise<CallOutcome<unknown>>;
}

function isMainFrame(event: IpcEvent): CallerFrame | undefined {
  const frame = event.senderFrame;
  return frame !== null &&
    frame.parent === null &&
    frame === event.sender.mainFrame
    ? frame
    : undefined;
}

/** sender가 살아 있는 앱 view의 main frame이고 그 view의 screen 주소일 때만 view를 돌려준다. */
function senderView(
  lookup: AppIpcDeps["view"],
  value: unknown,
): BoundView | undefined {
  const event = value as IpcEvent | undefined;
  if (
    event?.sender === undefined ||
    event.sender === null ||
    typeof event.sender.id !== "number" ||
    event.sender.isDestroyed()
  ) {
    return undefined;
  }
  const view = lookup(event.sender.id);
  const frame = isMainFrame(event);
  if (view === undefined || frame === undefined) return undefined;
  const parsed = parseAppUrl(
    frame.url,
    appHostLabel(view.target.app, view.machine),
  );
  return parsed !== undefined && parsed.screen === view.target.screen
    ? view
    : undefined;
}

const NOT_APP_VIEW: AppReply<never> = {
  ok: false,
  error: { code: "forbidden", message: "sender is not an app view" },
};

export function registerAppIpc(ipc: AppIpcHost, deps: AppIpcDeps): void {
  ipc.handle(APP_CALL_OPERATION_CHANNEL, async (event, input) => {
    const view = senderView(deps.view, event);
    return view === undefined ? NOT_APP_VIEW : await deps.call(view, input);
  });
  ipc.handle(APP_OPEN_EXTERNAL_CHANNEL, async (event, input) => {
    const view = senderView(deps.view, event);
    return view === undefined
      ? NOT_APP_VIEW
      : await deps.openExternal(view, input);
  });
  ipc.handle(APP_AGENTS_CHANNEL, async (event, input) => {
    const view = senderView(deps.view, event);
    return view === undefined
      ? NOT_APP_VIEW
      : await deps.agentsRun(view, input);
  });
  const sessionChannels = [
    [APP_SESSIONS_LIST_CHANNEL, deps.sessionsList],
    [APP_SESSIONS_STATUS_CHANNEL, deps.sessionsStatus],
    [APP_SESSIONS_STOP_CHANNEL, deps.sessionsStop],
  ] as const;
  for (const [channel, run] of sessionChannels) {
    ipc.handle(channel, async (event, input) => {
      const view = senderView(deps.view, event);
      return view === undefined ? NOT_APP_VIEW : await run(view, input);
    });
  }
  const agentChannels = [
    [APP_AGENT_OPEN_CHANNEL, deps.agentOpen],
    [APP_AGENT_SNAPSHOT_CHANNEL, deps.agentSnapshot],
    [APP_AGENT_SEND_CHANNEL, deps.agentSend],
  ] as const;
  for (const [channel, run] of agentChannels) {
    ipc.handle(channel, async (event, input) => {
      const view = senderView(deps.view, event);
      return view === undefined ? NOT_APP_VIEW : await run(view, input);
    });
  }
  ipc.handle(APP_PROJECTS_LIST_CHANNEL, async (event) => {
    const view = senderView(deps.view, event);
    return view === undefined ? NOT_APP_VIEW : await deps.projectsList(view);
  });
  ipc.on(APP_VIEW_ERROR_CHANNEL, (event, input) => {
    const view = senderView(deps.view, event);
    if (view !== undefined) void deps.viewError(view, input);
  });
}

export function removeAppIpc(ipc: AppIpcHost): void {
  ipc.removeHandler(APP_CALL_OPERATION_CHANNEL);
  ipc.removeHandler(APP_OPEN_EXTERNAL_CHANNEL);
  ipc.removeHandler(APP_AGENT_OPEN_CHANNEL);
  ipc.removeHandler(APP_AGENT_SNAPSHOT_CHANNEL);
  ipc.removeHandler(APP_AGENT_SEND_CHANNEL);
  ipc.removeHandler(APP_PROJECTS_LIST_CHANNEL);
  ipc.removeHandler(APP_AGENTS_CHANNEL);
  ipc.removeHandler(APP_SESSIONS_LIST_CHANNEL);
  ipc.removeHandler(APP_SESSIONS_STATUS_CHANNEL);
  ipc.removeHandler(APP_SESSIONS_STOP_CHANNEL);
  ipc.removeAllListeners(APP_VIEW_ERROR_CHANNEL);
}
