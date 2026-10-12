// Node 24의 fetch와 WebSocket을 contract client가 받는 모양으로 옮긴다.
// token은 여기 두지 않는다. caller가 headers로 넣어 준다.
import type { RpcFetch } from "../../../../protocol/client/mod.ts";

import type { StreamFetch } from "./client.ts";
import type { EventSocket, SocketFactory } from "./events.ts";

export const nodeFetch: RpcFetch = async (input, init) => {
  const response = await fetch(input, init);
  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
};

// 바이트 body·stream 응답 route. 응답 본문은 모으지 않고 소비자가 당겨 읽는다.
export const nodeStreamFetch: StreamFetch = async (input, init) => {
  const response = await fetch(input, init as RequestInit);
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
  };
};

// Node 24 global WebSocket(undici)은 브라우저 확장인 headers 옵션을 받는다.
// 두 번째 인자 객체의 headers가 upgrade 요청에 실려 core gate
// (packages/core/server/server.ts의 Bearer 필수)를 통과한다. token은 URL에 넣지 않는다.
export function nodeSockets(): SocketFactory {
  return {
    open(url, protocol, headers?: Record<string, string>) {
      const socket = new WebSocket(url, {
        protocols: [protocol],
        headers: headers ?? {},
      });
      const messages: ((text: string) => void)[] = [];
      const opens: (() => void)[] = [];
      const closes: (() => void)[] = [];
      socket.addEventListener("open", () => {
        for (const listener of opens) listener();
      });
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
        onOpen(listener) {
          opens.push(listener);
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
