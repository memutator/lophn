import {
  ARTIFACT_EVENT_CHANNEL,
  ARTIFACT_LIST_CHANNEL,
  ARTIFACT_OPEN_CHANNEL,
  ARTIFACT_RELOAD_CHANNEL,
  ARTIFACT_STATE_CHANNEL,
  type ArtifactEvent,
  artifactEventSchema,
  type ArtifactListItem,
  type ArtifactReply,
  type ArtifactViewState,
  artifactViewStateSchema,
  type LophnArtifactApi,
} from "../ipc/artifact.ts";
import type { ViewsTransport } from "./views-api.ts";

// 거절은 code만 싣는다. contextBridge가 Error의 다른 property를 넘기지 않는다.
async function call<T>(
  transport: ViewsTransport,
  channel: string,
  input: unknown,
): Promise<T> {
  let reply: ArtifactReply<T>;
  try {
    reply = (await transport.invoke(channel, input)) as ArtifactReply<T>;
  } catch {
    throw new Error("unavailable");
  }
  if (!reply.ok) throw new Error(reply.error.code);
  return reply.value;
}

function subscribe<T>(
  transport: ViewsTransport,
  channel: string,
  parse: (payload: unknown) => { success: true; data: T } | { success: false },
  listener: (value: T) => void,
): () => void {
  const callback = (_event: unknown, payload: unknown) => {
    const parsed = parse(payload);
    if (parsed.success) listener(parsed.data);
  };
  transport.on(channel, callback);
  return () => transport.removeListener(channel, callback);
}

export function createArtifactApi(transport: ViewsTransport): LophnArtifactApi {
  return Object.freeze({
    open: (input) =>
      call<ArtifactViewState>(transport, ARTIFACT_OPEN_CHANNEL, input),
    reload: (input) => call<null>(transport, ARTIFACT_RELOAD_CHANNEL, input),
    list: (input) =>
      call<{ artifacts: ArtifactListItem[] }>(
        transport,
        ARTIFACT_LIST_CHANNEL,
        input,
      ),
    subscribeState: (listener) =>
      subscribe(
        transport,
        ARTIFACT_STATE_CHANNEL,
        (payload) => artifactViewStateSchema.safeParse(payload),
        listener,
      ),
    subscribeEvent: (listener: (event: ArtifactEvent) => void) =>
      subscribe(
        transport,
        ARTIFACT_EVENT_CHANNEL,
        (payload) => artifactEventSchema.safeParse(payload),
        listener,
      ),
  } satisfies LophnArtifactApi);
}
