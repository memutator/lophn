// shell renderer가 쓰는 host 요청 통로. 채널 이름과 Electron event는 closure 안에만 있다.
import {
  type LophnSurfaceApi,
  SURFACE_ACK_CHANNEL,
  SURFACE_CONTROL_CHANNEL,
  SURFACE_REPORT_CHANNEL,
  SURFACE_REQUEST_CHANNEL,
  SURFACE_TAKE_CHANNEL,
  type SurfaceControl,
  type SurfaceRequest,
  SURFACE_WORKSPACE_CHANNEL,
} from "../ipc/surface.ts";

interface SurfaceTransport {
  invoke(channel: string, input?: unknown): Promise<unknown>;
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
}

// main이 보낸 값이다. 모양은 main이 보낼 때 정했으므로 주요 칸만 본다.
function isRequest(value: unknown): value is SurfaceRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = (value as { request?: unknown }).request;
  return (
    typeof request === "object" &&
    request !== null &&
    typeof (request as { id?: unknown }).id === "string"
  );
}

function isControl(value: unknown): value is SurfaceControl {
  if (typeof value !== "object" || value === null) return false;
  const control = value as Record<string, unknown>;
  return (
    typeof control.tab === "string" &&
    typeof control.agent === "boolean" &&
    typeof control.held === "boolean"
  );
}

export function createSurfaceApi(transport: SurfaceTransport): LophnSurfaceApi {
  const send = async (channel: string, input: unknown) => {
    await transport.invoke(channel, input).catch(() => {});
  };
  return Object.freeze({
    on(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        if (isRequest(payload)) listener(payload);
      };
      transport.on(SURFACE_REQUEST_CHANNEL, callback);
      return () => transport.removeListener(SURFACE_REQUEST_CHANNEL, callback);
    },
    ack: (input) => send(SURFACE_ACK_CHANNEL, input),
    workspace: (input) => send(SURFACE_WORKSPACE_CHANNEL, input),
    report: (input) => send(SURFACE_REPORT_CHANNEL, input),
    control(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        if (isControl(payload)) listener(payload);
      };
      transport.on(SURFACE_CONTROL_CHANNEL, callback);
      return () => transport.removeListener(SURFACE_CONTROL_CHANNEL, callback);
    },
    take: (tab) => send(SURFACE_TAKE_CHANNEL, { tab, held: true }),
    release: (tab) => send(SURFACE_TAKE_CHANNEL, { tab, held: false }),
  } satisfies LophnSurfaceApi);
}
