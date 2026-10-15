import {
  type AppFrameViewState,
  appFrameViewStateSchema,
  type LophnShellViewsApi,
  VIEW_BOUNDS_CHANNEL,
  VIEW_CLOSE_CHANNEL,
  VIEW_OPEN_APP_CHANNEL,
  VIEW_PROJECT_CHANNEL,
  VIEW_REOPEN_CHANNEL,
  VIEW_STATE_CHANNEL,
  type ViewReply,
  VIEWS_HIDDEN_CHANNEL,
  type VisibilityResult,
} from "../ipc/app-frame.ts";

export interface ViewsTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
}

// 거절은 code만 싣는다. contextBridge가 Error의 다른 property를 넘기지 않는다.
async function call<T>(
  transport: ViewsTransport,
  channel: string,
  input: unknown,
): Promise<T> {
  let reply: ViewReply<T>;
  try {
    reply = await transport.invoke(channel, input) as ViewReply<T>;
  } catch {
    throw new Error("unavailable");
  }
  if (!reply.ok) throw new Error(reply.error.code);
  return reply.value;
}

// transport는 closure 안에 남는다. 붙이기·숨기기·폐기는 main이 하고 여기서는 요청만 보낸다.
export function createViewsApi(transport: ViewsTransport): LophnShellViewsApi {
  return Object.freeze(
    {
      openApp: (input) =>
        call<AppFrameViewState>(transport, VIEW_OPEN_APP_CHANNEL, input),
      setViewBounds: (input) =>
        call<VisibilityResult>(transport, VIEW_BOUNDS_CHANNEL, input),
      setViewProject: (input) =>
        call<AppFrameViewState>(transport, VIEW_PROJECT_CHANNEL, input),
      setViewsHidden: (input) =>
        call<VisibilityResult>(transport, VIEWS_HIDDEN_CHANNEL, input),
      closeView: async (input) => {
        await call<null>(transport, VIEW_CLOSE_CHANNEL, input);
      },
      reopenView: (input) =>
        call<AppFrameViewState>(transport, VIEW_REOPEN_CHANNEL, input),
      subscribeViewState(listener) {
        const callback = (_event: unknown, payload: unknown) => {
          const parsed = appFrameViewStateSchema.safeParse(payload);
          if (parsed.success) listener(parsed.data);
        };
        transport.on(VIEW_STATE_CHANNEL, callback);
        return () => transport.removeListener(VIEW_STATE_CHANNEL, callback);
      },
    } satisfies LophnShellViewsApi,
  );
}
