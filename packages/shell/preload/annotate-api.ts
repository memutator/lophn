import {
  ANNOTATE_MODE_CHANNEL,
  ANNOTATE_REMOVE_CHANNEL,
  ANNOTATE_SEND_CHANNEL,
  ANNOTATE_STATE_CHANNEL,
  type AnnotateReply,
  type AnnotateSendResult,
  type AnnotateState,
  annotateStateSchema,
  type LophnShellAnnotateApi,
} from "../ipc/annotation.ts";
import type { ViewsTransport } from "./views-api.ts";

// 거절은 code만 싣는다. contextBridge가 Error의 다른 property를 넘기지 않는다.
async function call<T>(
  transport: ViewsTransport,
  channel: string,
  input: unknown,
): Promise<T> {
  let reply: AnnotateReply<T>;
  try {
    reply = await transport.invoke(channel, input) as AnnotateReply<T>;
  } catch {
    throw new Error("unavailable");
  }
  if (!reply.ok) throw new Error(reply.error.code);
  return reply.value;
}

export function createAnnotateApi(
  transport: ViewsTransport,
): LophnShellAnnotateApi {
  return Object.freeze(
    {
      setMode: (input) =>
        call<AnnotateState>(transport, ANNOTATE_MODE_CHANNEL, input),
      remove: (input) =>
        call<AnnotateState>(transport, ANNOTATE_REMOVE_CHANNEL, input),
      send: (input) =>
        call<AnnotateSendResult>(transport, ANNOTATE_SEND_CHANNEL, input),
      subscribeState(listener) {
        const callback = (_event: unknown, payload: unknown) => {
          const parsed = annotateStateSchema.safeParse(payload);
          if (parsed.success) listener(parsed.data);
        };
        transport.on(ANNOTATE_STATE_CHANNEL, callback);
        return () => transport.removeListener(ANNOTATE_STATE_CHANNEL, callback);
      },
    } satisfies LophnShellAnnotateApi,
  );
}
