// 창을 연 뒤 core를 띄운다. 연결 상태는 renderer로 밀되 token은 메모리에만 둔다.
import {
  CORE_CALL_CHANNEL,
  CORE_STATE_CHANNEL,
  coreCallSchema,
} from "../../../ipc/core.ts";
import type { RpcFetch } from "../../../../../packages/contracts/platform/mod.ts";

import { type CoreSession, openSession } from "./client.ts";
import { type Clock, type SocketFactory, subscribe } from "./events.ts";
import {
  type CoreProcess,
  type LaunchOptions,
  spawnCore,
} from "./supervise.ts";

export interface StateTarget {
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
}

export interface CoreIpc {
  handle(
    channel: string,
    listener: (event: unknown, input: unknown) => Promise<unknown>,
  ): void;
}

export interface ConnectionOptions {
  launch: LaunchOptions;
  ipc: CoreIpc;
  fetch: RpcFetch;
  sockets: SocketFactory;
  clock: Clock;
  /** 상태를 밀 대상. 창이 없으면 메모리에만 남긴다. */
  targets?: () => readonly StateTarget[];
  /** 테스트가 가짜 core를 끼운다. */
  start?: (options: LaunchOptions) => CoreProcess;
}

export interface ConnectionState {
  state: "starting" | "ready" | "stale" | "failed";
  confirmedAt: number | null;
}

export interface CoreConnection {
  readonly state: ConnectionState;
  /** 명시 종료. 창 닫기는 부르지 않는다. */
  shutdown(): void;
}

/** main 조립이 부른다. 준비 전에 창은 이미 열려 있다. */
export function startCoreConnection(
  options: ConnectionOptions,
): CoreConnection {
  const state: ConnectionState = { state: "starting", confirmedAt: null };
  let session: CoreSession | undefined;
  const core = (options.start ?? spawnCore)(options.launch);

  const push = () => {
    for (const target of options.targets?.() ?? []) {
      if (!target.isDestroyed()) target.send(CORE_STATE_CHANNEL, { ...state });
    }
  };

  core.hello.then((hello) => {
    session = openSession({
      apiPort: hello.api_port,
      coreEpoch: hello.core_epoch,
      userToken: hello.user_token,
      fetch: options.fetch,
    });
    state.state = "ready";
    push();
    subscribe({
      session,
      epoch: hello.core_epoch,
      socket: options.sockets,
      clock: options.clock,
      sink: {
        stale: (notice) => {
          state.state = "stale";
          state.confirmedAt = notice.confirmedAt;
          push();
        },
        caughtUp: () => {
          state.state = "ready";
          state.confirmedAt = options.clock.now();
          push();
        },
      },
    });
  }).catch(() => {
    state.state = "failed";
    push();
  });

  options.ipc.handle(CORE_CALL_CHANNEL, async (_event, input) => {
    const parsed = coreCallSchema.safeParse(input);
    if (!parsed.success || session === undefined) {
      return {
        ok: false,
        error: { code: "unavailable", message: "core가 준비되지 않았다" },
      };
    }
    return await session.call(
      parsed.data.kind,
      parsed.data.resource,
      parsed.data.method,
      parsed.data.body,
    );
  });

  return {
    get state() {
      return state;
    },
    shutdown() {
      core.stop();
    },
  };
}
