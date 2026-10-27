import {
  DETACHED_CHANGED_CHANNEL,
  DETACHED_CLOSE_CHANNEL,
  DETACHED_DOCK_CHANNEL,
  DETACHED_EVENT_CHANNEL,
  DETACHED_FOCUS_CHANNEL,
  DETACHED_OPEN_CHANNEL,
  DETACHED_OPEN_TAB_CHANNEL,
  DETACHED_REMOVE_CHANNEL,
  DETACHED_SHOW_CHANNEL,
  DETACHED_TAKE_CHANNEL,
  type DetachedBounds,
  detachedEventSchema,
  type DetachedReply,
  type DetachedTaken,
  type LophnDetachedApi,
} from "../ipc/detached.ts";
import type { ViewsTransport } from "./views-api.ts";

// 거절은 code만 싣는다. contextBridge가 Error의 다른 property를 넘기지 않는다.
async function call<T>(
  transport: ViewsTransport,
  channel: string,
  input?: unknown,
): Promise<T> {
  let reply: DetachedReply<T>;
  try {
    reply = (await transport.invoke(channel, input)) as DetachedReply<T>;
  } catch {
    throw new Error("unavailable");
  }
  if (!reply.ok) throw new Error(reply.error.code);
  return reply.value;
}

// 보낸 창이 맞는 쪽인지는 main이 가린다. 여기는 요청만 보낸다.
export function createDetachedApi(transport: ViewsTransport): LophnDetachedApi {
  return Object.freeze({
    open: (input) =>
      call<{ bounds: DetachedBounds }>(transport, DETACHED_OPEN_CHANNEL, input),
    focus: async (input) => {
      await call<null>(transport, DETACHED_FOCUS_CHANNEL, input);
    },
    close: async (input) => {
      await call<null>(transport, DETACHED_CLOSE_CHANNEL, input);
    },
    showOnly: (input) =>
      call<{ missing: string[] }>(transport, DETACHED_SHOW_CHANNEL, input),
    take: () => call<DetachedTaken>(transport, DETACHED_TAKE_CHANNEL),
    dock: async (input) => {
      await call<null>(transport, DETACHED_DOCK_CHANNEL, input);
    },
    changed: async (input) => {
      await call<null>(transport, DETACHED_CHANGED_CHANNEL, input);
    },
    openTab: async (input) => {
      await call<null>(transport, DETACHED_OPEN_TAB_CHANNEL, input);
    },
    remove: async () => {
      await call<null>(transport, DETACHED_REMOVE_CHANNEL);
    },
    subscribe(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        const parsed = detachedEventSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      transport.on(DETACHED_EVENT_CHANNEL, callback);
      return () => transport.removeListener(DETACHED_EVENT_CHANNEL, callback);
    },
  } satisfies LophnDetachedApi);
}
