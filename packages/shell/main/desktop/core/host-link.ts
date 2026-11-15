// shell main(host)이 core의 `/host-link`에 붙는 연결이다(`ctx.hostLink`). frame은 `protocol/host-link/frames.ts`.
// 열리면 `hello`부터 보내고, core가 민 `request`를 종류마다 단 처리기로 돌려 `response`로 답한다. 끊기면 1초에서 30초까지
// 두 배씩 늘려 다시 붙는다. core가 다시 떠 주소와 token이 바뀌면 `refresh`가 새 값으로 바로 붙는다.
// 끊긴 연결로 받은 요청의 답은 버린다: core가 그 결과 요청을 이미 `unavailable`로 끝냈고 탭 요청은 다시 민다.
// test가 돌도록 Electron을 import하지 않는다.
import {
  type CoreFrame,
  HOST_LINK_PATH,
  HOST_LINK_SUBPROTOCOL,
  type HostFrame,
  hostFrameSchema,
} from "../../../../protocol/host-link/mod.ts";
import type {
  HostRequest,
  HostToolOutput,
  HostWorkspace,
} from "../../../../protocol/lophn-agent/host-queue.ts";

import type { EventSocket, SocketFactory } from "./events.ts";

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** 연결을 열 곳. core가 준비되기 전에는 없다. */
export type HostLinkTarget = {
  apiPort: number;
  headers: Record<string, string>;
};

export type HostRequestKind = HostRequest["kind"];
export type HostRequestOf<K extends HostRequestKind> = Extract<
  HostRequest,
  { kind: K }
>;
/** 돌려준 output을 이 서비스가 `response`(done)로 보낸다. null이면 처리기가 `send`로 직접 답한다(retry, 나중에 오는 답). */
export type HostRequestHandler<K extends HostRequestKind> = (
  payload: HostRequestOf<K>["payload"],
  request: HostRequestOf<K>,
) => Promise<HostToolOutput | null>;

/** host가 지금 그리는 workspace와 TUI 탭이 열린 session. `hello`와 `visible`에 싣는다. */
export type HostVisible = { workspaces: HostWorkspace[]; tui: string[] };

export type HostLink = {
  /** 연결이 열려 있고 frame이 schema에 맞으면 보내고 true다. */
  send(frame: HostFrame): boolean;
  /** 한 종류에 처리기 하나다. 처리기가 없는 종류는 `unavailable`로 답한다. */
  onRequest<K extends HostRequestKind>(
    kind: K,
    handler: HostRequestHandler<K>,
  ): void;
  /** `hello`를 보낸 뒤 부른다. 다시 붙을 때마다 부른다. */
  onOpen(handler: () => void): void;
  connected(): boolean;
  /** 보이는 것이 바뀌었을 수 있다. 바뀌었으면 `visible`을 보내고, 다음 `hello`도 이 값을 싣는다. */
  visible(next: HostVisible): void;
};

export type HostLinkService = HostLink & {
  /** core가 (다시) 준비됐다. 대상이 바뀌었거나 닫혀 있으면 기다리지 않고 지금 붙는다. */
  refresh(): void;
  stop(): void;
};

export function createHostLink(deps: {
  target(): HostLinkTarget | null;
  sockets: SocketFactory;
  /** run을 ms 뒤 부르고 취소 함수를 돌려준다. */
  schedule?(run: () => void, ms: number): () => void;
  log?(message: string): void;
}): HostLinkService {
  const schedule =
    deps.schedule ??
    ((run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  const handlers = new Map<
    HostRequestKind,
    (
      payload: HostRequest["payload"],
      request: HostRequest,
    ) => Promise<HostToolOutput | null>
  >();
  const openHandlers: (() => void)[] = [];
  let shown: HostVisible = { workspaces: [], tui: [] };
  let socket: EventSocket | undefined;
  // 지금 socket이 붙은 대상. 같으면 refresh가 다시 열지 않는다.
  let socketKey = "";
  let open = false;
  // 새 socket을 열 때마다 올려 옛 socket의 늦은 callback과 그 연결로 받은 요청의 답을 거른다.
  let generation = 0;
  let delay = BACKOFF_MIN_MS;
  let cancelRetry: (() => void) | undefined;
  let stopped = false;

  function write(frame: HostFrame): boolean {
    if (!open || socket === undefined) return false;
    const parsed = hostFrameSchema.safeParse(frame);
    if (!parsed.success) {
      deps.log?.(`host link: dropped an invalid ${frame.type} frame`);
      return false;
    }
    try {
      socket.send(JSON.stringify(parsed.data));
      return true;
    } catch {
      return false;
    }
  }

  function retryLater(): void {
    if (stopped || cancelRetry !== undefined) return;
    const wait = delay;
    delay = Math.min(delay * 2, BACKOFF_MAX_MS);
    cancelRetry = schedule(() => {
      cancelRetry = undefined;
      connect();
    }, wait);
  }

  function drop(): void {
    generation += 1;
    open = false;
    const old = socket;
    socket = undefined;
    old?.close();
  }

  function respond(mine: number, id: string, output: HostToolOutput): void {
    if (mine !== generation) return;
    write({ type: "response", id, result: "done", output });
  }

  function receive(mine: number, text: string): void {
    let frame: CoreFrame;
    try {
      frame = JSON.parse(text) as CoreFrame;
    } catch {
      return;
    }
    if (frame.type !== "request") return;
    const request = frame as HostRequest;
    const handler = handlers.get(request.kind);
    if (handler === undefined) {
      respond(mine, request.id, {
        error: {
          code: "unavailable",
          message: `This lophn app cannot handle ${request.kind} requests yet.`,
        },
      });
      return;
    }
    Promise.resolve()
      .then(() => handler(request.payload, request))
      .then(
        (output) => {
          if (output !== null) respond(mine, request.id, output);
        },
        (thrown: unknown) =>
          respond(mine, request.id, {
            error: {
              code: "internal",
              message:
                thrown instanceof Error ? thrown.message : String(thrown),
            },
          }),
      );
  }

  function connect(): void {
    cancelRetry?.();
    cancelRetry = undefined;
    if (stopped) return;
    const target = deps.target();
    if (target === null) return retryLater();
    drop();
    const mine = generation;
    socketKey = JSON.stringify(target);
    let opened: EventSocket;
    try {
      opened = deps.sockets.open(
        `ws://127.0.0.1:${target.apiPort}${HOST_LINK_PATH}`,
        HOST_LINK_SUBPROTOCOL,
        target.headers,
      );
    } catch {
      return retryLater();
    }
    socket = opened;
    opened.onOpen(() => {
      if (mine !== generation) return;
      open = true;
      delay = BACKOFF_MIN_MS;
      write({ type: "hello", version: 1, ...shown });
      for (const handler of openHandlers) {
        try {
          handler();
        } catch (thrown) {
          deps.log?.(`host link: open handler threw: ${String(thrown)}`);
        }
      }
    });
    opened.onMessage((text) => {
      if (mine === generation) receive(mine, text);
    });
    opened.onClose(() => {
      if (mine !== generation) return;
      generation += 1;
      open = false;
      socket = undefined;
      retryLater();
    });
  }

  return {
    send: write,
    onRequest(kind, handler) {
      if (handlers.has(kind)) {
        throw new Error(`host link request ${kind} already has a handler`);
      }
      handlers.set(kind, handler as never);
    },
    onOpen(handler) {
      openHandlers.push(handler);
    },
    connected: () => open,
    visible(next) {
      if (JSON.stringify(next) === JSON.stringify(shown)) return;
      shown = next;
      write({ type: "visible", ...shown });
    },
    refresh() {
      if (stopped) return;
      const target = deps.target();
      if (
        target !== null &&
        socket !== undefined &&
        JSON.stringify(target) === socketKey
      ) {
        return;
      }
      delay = BACKOFF_MIN_MS;
      connect();
    },
    stop() {
      stopped = true;
      cancelRetry?.();
      cancelRetry = undefined;
      drop();
    },
  };
}
