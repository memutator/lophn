// Node의 fetch와 WebSocket을 contract client가 받는 모양으로 옮긴다. token은 여기 두지 않는다.
import type { RpcFetch } from "../../../../../packages/contracts/platform/mod.ts";

import type { EventSocket, SocketFactory } from "./events.ts";

export const nodeFetch: RpcFetch = async (input, init) => {
  const response = await fetch(input, init);
  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
};

export function nodeSockets(): SocketFactory {
  return {
    open(url, protocol) {
      // 브라우저 WebSocket은 임의 header를 못 싣는다. token을 URL에 넣지 않고
      // loopback으로만 연다. 인증 header를 요구하는 구독은 core가 정한다.
      const socket = new WebSocket(url, [protocol]);
      const messages: ((text: string) => void)[] = [];
      const closes: (() => void)[] = [];
      socket.addEventListener("message", (event) => {
        for (const listener of messages) listener(String(event.data));
      });
      socket.addEventListener("close", () => {
        for (const listener of closes) listener();
      });
      const opened: EventSocket = {
        send(text) {
          socket.send(text);
        },
        close() {
          socket.close();
        },
        onMessage(listener) {
          messages.push(listener);
        },
        onClose(listener) {
          closes.push(listener);
        },
      };
      return opened;
    },
  };
}
