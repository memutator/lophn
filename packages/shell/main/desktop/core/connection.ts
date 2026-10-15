// 창을 연 뒤 core를 띄운다. 연결 상태는 renderer로 밀되 token은 메모리에만 둔다.
import {
  type ConnectionState as ShellConnectionState,
  CORE_CALL_CHANNEL,
  CORE_EVENT_CHANNEL,
  CORE_STATE_CHANNEL,
  CORE_STATE_GET_CHANNEL,
  CORE_WATCH_CHANNEL,
  coreCallSchema,
  type CoreEventMessage,
  coreWatchSchema,
} from "../../../ipc/core.ts";
import type { RpcFetch } from "../../../../protocol/client/mod.ts";
import type {
  BusEvent,
  EventCondition,
} from "../../../../protocol/events/mod.ts";

import { type CoreSession, openSession, type StreamFetch } from "./client.ts";
import {
  backoffReconnect,
  type Clock,
  type Gateway,
  openGateway,
  type ReconnectPolicy,
  type SocketFactory,
} from "./events.ts";
import { type IpcEvent } from "../ipc-guard.ts";
import {
  type CoreProcess,
  type LaunchOptions,
  spawnCore,
  StartFailedError,
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
  /** 바이트 route(파일 읽기 stream, 업로드). main 안의 편집기 adapter만 쓴다. */
  stream?: StreamFetch;
  sockets: SocketFactory;
  clock: Clock;
  /** 상태를 밀 대상. 창이 없으면 메모리에만 남긴다. */
  targets?: () => readonly StateTarget[];
  /** sender 검사에 쓰는 등록 contents. registry가 없으면 sender를 보지 않는다. */
  contentsRegistry?: {
    checkCaller(event: IpcEvent): { ok: true } | { ok: false };
  };
  /** 끊긴 Gateway 연결을 다시 잇는 시각. 테스트가 끼운다. 기본은 backoff다. */
  reconnect?: ReconnectPolicy;
  /** 테스트가 가짜 core를 끼운다. */
  start?: (options: LaunchOptions) => CoreProcess;
  /**
   * main 자신이 보는 event. 조건은 renderer의 조건과 합쳐 건다. event는 renderer에도 같이 가지만
   * main이 먼저 쓴다.
   */
  own?: {
    conditions(): readonly EventCondition[];
    event(event: BusEvent): void;
  };
  /**
   * allowlist 호출을 core로 보내기 전에 main이 붙인다. 실패해도 그 호출은
   * 그대로 보낸다(현재 보기 bind가 사람 메시지를 막지 않는다).
   */
  beforeCall?: (
    event: IpcEvent,
    call: { kind: string; resource: string; method: string; body: unknown },
  ) => Promise<void>;
}

export type ConnectionState = ShellConnectionState;

export interface CoreConnection {
  readonly state: ConnectionState;
  /** 준비된 인증 read·command session. 준비 전에는 null이다. */
  session(): CoreSession | null;
  /** 닫힌 창(webContents id)의 구독 조건을 뺀다. */
  forget(owner: number): void;
  /** 명시 종료. 창 닫기는 부르지 않는다. */
  shutdown(): void;
  /** main의 안전 진단을 감독 pipe로 보낸다. 보내지 못하면 false다. */
  diagnostic(message: unknown): boolean;
  /**
   * 사람 결정 handle을 비공개 pipe로 등록한다. 응답에 짝 id가 없으므로 한 번에 하나씩 보내고,
   * core가 발급하지 않으면 답이 없으므로 기한 안에 오지 않으면 unavailable이다.
   */
  registerConfirmation(request: unknown): Promise<
    | { ok: true; confirmation: string; expiresAt: string }
    | { ok: false; error: { code: string; message: string } }
  >;
}

/** handle 등록 응답을 기다리는 시간. 넘으면 그 등록은 없다. */
export const CONFIRMATION_REPLY_MS = 5_000;

/** main 조립이 부른다. 준비 전에 창은 이미 열려 있다. */
export function startCoreConnection(
  options: ConnectionOptions,
): CoreConnection {
  const state: ConnectionState = { state: "starting", confirmedAt: null };
  let session: CoreSession | undefined;
  // handle 등록은 한 번에 하나씩 보낸다.
  let registering: Promise<unknown> = Promise.resolve();
  const core = (options.start ?? spawnCore)(options.launch);
  const push = () => {
    for (const target of options.targets?.() ?? []) {
      if (!target.isDestroyed()) target.send(CORE_STATE_CHANNEL, { ...state });
    }
  };

  // renderer들이 건 조건. Gateway가 붙기 전에 온 것도 여기 남았다가 붙을 때 건다.
  const watching = new Map<number, unknown[]>();
  let gateway: Gateway | undefined;

  const relay = (message: CoreEventMessage) => {
    for (const target of options.targets?.() ?? []) {
      if (!target.isDestroyed()) target.send(CORE_EVENT_CHANNEL, message);
    }
  };

  // hello 하나에 session·Gateway 연결을 연다.
  const greet = (hello: {
    readonly user_token: string;
    readonly api_port: number;
    readonly core_epoch: string;
  }) => {
    session = openSession({
      apiPort: hello.api_port,
      coreEpoch: hello.core_epoch,
      userToken: hello.user_token,
      fetch: options.fetch,
      ...(options.stream ? { stream: options.stream } : {}),
    });
    state.state = "ready";
    push();
    gateway = openGateway({
      session,
      epoch: hello.core_epoch,
      // core 프로세스가 끝났으면 다시 붙을 곳이 없다.
      reconnectPolicy: options.reconnect ??
        backoffReconnect(() => core.phase !== "stopped"),
      // token은 이 closure에만 묶여 URL·renderer로 나가지 않는다.
      // Node의 WebSocket(undici)은 headers 옵션으로 Bearer를 싣는다.
      headers: () => ({ Authorization: `Bearer ${hello.user_token}` }),
      socket: options.sockets,
      clock: options.clock,
      own: () => options.own?.conditions() ?? [],
      sink: {
        stale: (notice) => {
          state.state = "stale";
          state.confirmedAt = notice.confirmedAt;
          push();
        },
        ready: () => {
          state.state = "ready";
          state.confirmedAt = options.clock.now();
          push();
        },
        // renderer에 가는 것은 ready·event·closed뿐이다. 터미널 요청 같은 frame은 main 전용이다.
        frame: (frame) => {
          if (frame.type === "ready") relay({ kind: "ready" });
          else if (frame.type === "event") {
            options.own?.event(frame.event);
            relay({ kind: "event", event: frame.event });
          } else if (frame.type === "closed") {
            relay({ kind: "closed", reason: frame.reason });
          }
        },
      },
    });
    for (const [owner, conditions] of watching) {
      gateway.watch(owner, conditions);
    }
  };

  core.hello.then(greet).catch((error) => {
    // 이유를 알린 시작 실패는 화면이 구별해 보인다. 이유를 모르거나 `other`면 그냥 시작 실패다.
    if (error instanceof StartFailedError && error.reason !== "other") {
      state.state = "failed-schema";
      state.schemaFailure = error.reason;
    } else state.state = "failed-start";
    push();
  });

  // 새로 구독하는 renderer(런처로 돌아옴·창 다시 읽기)는 지금 상태를 한 번 묻는다. push는
  // 상태가 바뀔 때와 창이 load를 끝낼 때뿐이라 이미 지난 상태는 이 답으로만 받는다.
  options.ipc.handle(
    CORE_STATE_GET_CHANNEL,
    () => Promise.resolve({ ...state }),
  );

  // 이 renderer의 조건을 통째로 바꾼다. sender 검사는 call과 같다.
  options.ipc.handle(CORE_WATCH_CHANNEL, (event, input) => {
    if (options.contentsRegistry !== undefined) {
      const caller = options.contentsRegistry.checkCaller(event as IpcEvent);
      if (!caller.ok) return Promise.resolve(undefined);
    }
    const parsed = coreWatchSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(undefined);
    const owner = (event as IpcEvent).sender.id;
    watching.set(owner, parsed.data.conditions);
    gateway?.watch(owner, parsed.data.conditions);
    return Promise.resolve(undefined);
  });

  options.ipc.handle(CORE_CALL_CHANNEL, async (event, input) => {
    // sender 검사는 guardIpc의 checkCaller로 본다. 등록 registry가 없으면 보지 않는다.
    if (options.contentsRegistry !== undefined) {
      const caller = options.contentsRegistry.checkCaller(event as IpcEvent);
      if (!caller.ok) {
        return {
          ok: false,
          error: { code: "forbidden", message: "허용되지 않은 sender다" },
        };
      }
    }
    const parsed = coreCallSchema.safeParse(input);
    if (!parsed.success || session === undefined) {
      return {
        ok: false,
        error: { code: "unavailable", message: "core가 준비되지 않았다" },
      };
    }
    if (options.beforeCall) {
      try {
        await options.beforeCall(event as IpcEvent, parsed.data);
      } catch {
        // 보기 결합이 실패해도 사람 메시지는 보낸다.
      }
    }
    return await session.call(
      parsed.data.kind,
      parsed.data.resource,
      parsed.data.method,
      parsed.data.body,
      parsed.data.bytes,
    );
  });

  return {
    get state() {
      return state;
    },
    session() {
      return session ?? null;
    },
    forget(owner) {
      watching.delete(owner);
      gateway?.forget(owner);
    },
    shutdown() {
      gateway?.stop();
      core.stop();
    },
    diagnostic(message) {
      return core.diagnostic(message);
    },
    registerConfirmation(request) {
      const run = () => registerOnce(core, request);
      const next = registering.then(run, run);
      registering = next.catch(() => undefined);
      return next;
    },
  };
}

type Registered =
  | { ok: true; confirmation: string; expiresAt: string }
  | { ok: false; error: { code: string; message: string } };

const NO_HANDLE: Registered = {
  ok: false,
  error: { code: "unavailable", message: "확인 handle을 받지 못했다" },
};

function registerOnce(
  core: CoreProcess,
  request: unknown,
): Promise<Registered> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Registered) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(value);
    };
    const off = core.onMessage((payload) => {
      const message = payload as {
        type?: unknown;
        confirmation?: unknown;
        expires_at?: unknown;
      };
      if (
        message.type === "confirmation_handle_registered" &&
        typeof message.confirmation === "string" &&
        typeof message.expires_at === "string"
      ) {
        finish({
          ok: true,
          confirmation: message.confirmation,
          expiresAt: message.expires_at,
        });
      }
    });
    const timer = setTimeout(() => finish(NO_HANDLE), CONFIRMATION_REPLY_MS);
    if (!core.confirmation(request)) finish(NO_HANDLE);
  });
}
