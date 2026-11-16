import type { RemoteTransport } from "../protocol/remote/client.ts";

// The standard global WebSocket (React Native, Node, Electron main) as a remote transport.
export function dialWebSocket(url: string): Promise<RemoteTransport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const handlers = { message: (_: Uint8Array) => {}, close: () => {} };
    ws.onmessage = (event) =>
      handlers.message(new Uint8Array(event.data as ArrayBuffer));
    ws.onclose = () => handlers.close();
    ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
    ws.onopen = () =>
      resolve({
        send: (bytes) => ws.send(bytes),
        close: () => ws.close(),
        onMessage: (fn) => {
          handlers.message = fn;
        },
        onClose: (fn) => {
          handlers.close = fn;
        },
      });
  });
}
