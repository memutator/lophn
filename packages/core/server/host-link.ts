// shell main(host)과 core의 양방향 연결 `/host-link`다. frame은 `protocol/host-link/frames.ts`.
// 연결이 `hello`로 열리면 host queue가 요청을 `request` frame으로 바로 밀고, `response`·`report`는 queue로, TUI 목록은 hold로 간다.
// coding session과 터미널 frame은 다른 wiring이 `onFrame`으로 받는다. 연결은 한 번에 하나이고 새 연결이 옛 연결을 닫는다.
import type { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Logger } from "../../base/mod.ts";
import { describeThrown } from "../../base/telemetry/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  type CoreFrame,
  HOST_LINK_BUFFER_LIMIT,
  HOST_LINK_CLOSE_INVALID,
  HOST_LINK_FRAME_MAX_BYTES,
  HOST_LINK_SUBPROTOCOL,
  type HostFrame,
  type HostFrameOf,
  type HostFrameType,
  parseHostFrame,
} from "../../protocol/host-link/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import type { HostQueueService } from "../host-queue/mod.ts";
import { failure } from "./request.ts";
import { refuseSocket } from "./socket.ts";

// 읽지 못한 frame이 쌓인 host를 닫는 code다(Gateway의 slow consumer와 같다).
const CLOSE_SLOW = 1013;
const CLOSE_REPLACED = 1000;
const CLOSE_SHUTDOWN = 1001;
// 연결이 열린 동안 기한이 지난 요청을 거두고, 다시 대기한 요청(retry, 빌린 기한이 지난 탭 요청)을 밀고, TUI hold를 갱신하는 간격이다.
// hold 갱신(10초)보다 넉넉히 짧다.
const TICK_MS = 1_000;

// 이 file이 직접 처리하는 frame이다. 나머지는 다른 wiring이 `onFrame`으로 받는다.
type OwnFrameType = "hello" | "visible" | "response" | "report";
export type RelayedFrameType = Exclude<HostFrameType, OwnFrameType>;

// 실제 WebSocket과 test의 메모리 socket이 둘 다 맞춘다.
export type HostLinkSocket = {
  send(text: string): void;
  close(code: number): void;
  bufferedAmount(): number;
};

export type HostLinkQueue = Pick<
  HostQueueService,
  "connect" | "done" | "report" | "expire"
>;

// `ctx.hostLink`다.
export type HostLink = {
  // `hello`를 받은 연결이 열려 있다.
  attached(): boolean;
  // 한 종류에 처리기 하나다. 연결이 바뀌어도 그대로다.
  onFrame<T extends RelayedFrameType>(
    type: T,
    handler: (frame: HostFrameOf<T>) => void,
  ): void;
  // `hello`를 받아 queue가 붙은 뒤 부른다. 다시 붙을 때마다 부른다.
  onOpen(handler: () => void): void;
  // 열렸던 연결이 닫힌 바로 뒤(queue가 그 연결의 요청을 거둔 뒤) 부른다.
  onClose(handler: () => void): void;
  // server가 받은 socket 하나를 연결로 삼는다. 옛 연결은 닫는다.
  attach(socket: HostLinkSocket): {
    receive(text: string): void;
    closed(): void;
  };
  shutdown(): void;
};

type Connection = {
  socket: HostLinkSocket;
  done: boolean;
  // `hello`를 받은 뒤의 queue 연결이다.
  queue: ReturnType<HostLinkQueue["connect"]> | null;
  tui: readonly Id<"ses">[];
  tick: ReturnType<typeof setInterval> | undefined;
};

export function createHostLink(deps: {
  queue: HostLinkQueue;
  // TUI 탭이 열린 session 전부로 hold를 갱신한다.
  heartbeat(tui: readonly Id<"ses">[]): void;
  logger?: Logger;
}): HostLink {
  const handlers = new Map<string, (frame: HostFrame) => void>();
  const openHandlers: (() => void)[] = [];
  const closeHandlers: (() => void)[] = [];
  let current: Connection | null = null;

  // 다른 wiring의 처리기가 던져도 연결과 나머지 처리기는 그대로 간다.
  function guarded(run: () => void) {
    try {
      run();
    } catch (thrown) {
      deps.logger?.error({
        component: "host-link",
        event: "handler_threw",
        fields: describeThrown(thrown),
      });
    }
  }

  function end(connection: Connection, code?: number) {
    if (connection.done) return;
    connection.done = true;
    clearInterval(connection.tick);
    if (code !== undefined) {
      try {
        connection.socket.close(code);
      } catch {
        /* 이미 닫혔다 */
      }
    }
    if (current === connection) current = null;
    if (connection.queue === null) return;
    connection.queue.close();
    for (const handler of closeHandlers) guarded(handler);
  }

  function write(connection: Connection, frame: CoreFrame) {
    if (connection.done) return;
    try {
      connection.socket.send(JSON.stringify(frame));
    } catch {
      /* 이미 닫혔다. close가 곧 온다 */
    }
    if (connection.socket.bufferedAmount() > HOST_LINK_BUFFER_LIMIT) {
      end(connection, CLOSE_SLOW);
    }
  }

  function visible(
    connection: Connection,
    frame: HostFrameOf<"hello"> | HostFrameOf<"visible">,
  ) {
    connection.tui = frame.tui as Id<"ses">[];
    deps.heartbeat(connection.tui);
    connection.queue?.visible(frame.workspaces);
  }

  function open(connection: Connection, hello: HostFrameOf<"hello">) {
    connection.queue = deps.queue.connect((request) =>
      write(connection, { type: "request", ...request }),
    );
    visible(connection, hello);
    if (connection.done) return;
    connection.tick = setInterval(() => {
      deps.queue.expire();
      connection.queue?.pump();
      deps.heartbeat(connection.tui);
    }, TICK_MS);
    connection.tick.unref?.();
    for (const handler of openHandlers) guarded(handler);
  }

  function receive(connection: Connection, text: string) {
    if (connection.done) return;
    const parsed = parseHostFrame(text);
    if (!parsed.ok) return end(connection, HOST_LINK_CLOSE_INVALID);
    const frame = parsed.value;
    // 첫 frame은 `hello`이고 그 뒤로는 다시 오지 않는다.
    if ((connection.queue === null) !== (frame.type === "hello")) {
      return end(connection, HOST_LINK_CLOSE_INVALID);
    }
    switch (frame.type) {
      case "hello":
        return open(connection, frame);
      case "visible":
        return visible(connection, frame);
      case "response":
        return deps.queue.done(
          frame.id as Id<"hrq">,
          frame.result,
          frame.output,
        );
      case "report":
        return deps.queue.report(frame.tab as Id<"tab">, frame.state);
      default: {
        const handler = handlers.get(frame.type);
        if (handler !== undefined) guarded(() => handler(frame));
      }
    }
  }

  return {
    attached: () => current !== null && current.queue !== null,
    onFrame(type, handler) {
      if (handlers.has(type)) {
        throw new Error(`host-link frame ${type} already has a handler`);
      }
      handlers.set(type, handler as (frame: HostFrame) => void);
    },
    onOpen(handler) {
      openHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
    attach(socket) {
      if (current !== null) end(current, CLOSE_REPLACED);
      const connection: Connection = {
        socket,
        done: false,
        queue: null,
        tui: [],
        tick: undefined,
      };
      current = connection;
      return {
        receive: (text) => receive(connection, text),
        closed: () => end(connection),
      };
    },
    shutdown() {
      if (current !== null) end(current, CLOSE_SHUTDOWN);
    },
  };
}

export type HostLinkUpgrade = {
  // Host·Origin·Bearer gate를 지난 upgrade를 받는다. 사람 자격, GET, subprotocol을 본다.
  accept(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: AuthenticatedContext,
  ): void;
  activity(): { active: number; arrivals: number };
  shutdown(): void;
};

export function createHostLinkUpgrade(deps: {
  link: HostLink;
}): HostLinkUpgrade {
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: HOST_LINK_FRAME_MAX_BYTES,
    // accept가 이미 같은 subprotocol을 확인했다.
    handleProtocols: () => HOST_LINK_SUBPROTOCOL,
  });
  let arrivals = 0;
  return {
    accept(request, socket, head, context) {
      // shell main은 사람 token으로 붙는다. agent·앱 자격은 queue를 가로채지 못한다.
      if (context.actor !== "user") {
        return refuseSocket(
          socket,
          failure({
            code: "forbidden",
            message: "host link is for the person's credential",
          }),
        );
      }
      const offered = request.headers["sec-websocket-protocol"];
      if (
        request.method !== "GET" ||
        !(offered ?? "")
          .split(",")
          .map((part) => part.trim())
          .includes(HOST_LINK_SUBPROTOCOL)
      ) {
        return refuseSocket(
          socket,
          failure({
            code: "invalid_input",
            message: `GET with subprotocol ${HOST_LINK_SUBPROTOCOL} required`,
          }),
        );
      }
      // event 연결 한도(사람 token의 Gateway·CLI watch 몫)를 쓰지 않는다. 연결은 한 번에 하나라 새 연결이 옛 연결을 닫는다(`attach`).
      server.handleUpgrade(request, socket, head, (ws) => {
        arrivals += 1;
        const peer = deps.link.attach({
          send: (text) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(text);
          },
          close: (code) => ws.close(code),
          bufferedAmount: () => ws.bufferedAmount,
        });
        ws.on("message", (data, binary) => {
          if (binary) ws.close(HOST_LINK_CLOSE_INVALID);
          else peer.receive(String(data));
        });
        ws.on("close", peer.closed);
        ws.on("error", peer.closed);
      });
    },
    activity: () => ({ active: server.clients.size, arrivals }),
    shutdown() {
      deps.link.shutdown();
      // upgraded socket은 server.close()가 닫지 않는다.
      for (const client of [...server.clients]) client.terminate();
    },
  };
}
