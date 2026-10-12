import type { OverlayApi, OverlayEvent, OverlayReply } from "../ipc/overlay.ts";

export interface OverlayTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
  on(
    channel: string,
    callback: (event: unknown, payload: OverlayEvent) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: OverlayEvent) => void,
  ): void;
}
const unavailable = () => ({
  ok: false as const,
  error: {
    code: "unavailable" as const,
    message: "Overlay transport is unavailable",
  },
});

// transport는 closure 안에 남는다. Electron event와 generic channel은 페이지로 보내지 않는다.
export function createShellApi(
  transport: OverlayTransport,
  role: "shell" | "overlay",
): OverlayApi {
  async function invoke<T>(
    channel: string,
    input: unknown,
  ): Promise<OverlayReply<T>> {
    try {
      return await transport.invoke(channel, input) as OverlayReply<T>;
    } catch {
      return unavailable();
    }
  }
  return Object.freeze(
    {
      open: (input) => invoke("shell:overlay-open", input),
      close: (input) => invoke("shell:overlay-close", input),
      update: (input) => invoke("shell:overlay-update", input),
      result: (input) => invoke("overlay:result", input),
      subscribe(listener, onError) {
        let active = true;
        const channel = role === "overlay"
          ? "overlay:state"
          : "shell:overlay-result";
        const callback = (_event: unknown, payload: OverlayEvent) => {
          if (active) listener(payload);
        };
        transport.on(channel, callback);
        if (role === "overlay") {
          invoke<null>("overlay:subscribe", {}).then((result) => {
            if (active && !result.ok) onError(result.error);
          });
        }
        return () => {
          active = false;
          transport.removeListener(channel, callback);
        };
      },
    } satisfies OverlayApi,
  );
}
