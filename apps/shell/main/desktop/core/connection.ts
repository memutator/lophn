// 창을 연 뒤 core를 띄운다. 연결 상태는 renderer로 밀되 token은 메모리에만 둔다.
import {
  CORE_CALL_CHANNEL,
  CORE_STATE_CHANNEL,
  CORE_STATE_GET_CHANNEL,
  coreCallSchema,
} from "../../../ipc/core.ts";
import type { RpcFetch } from "../../../../../packages/contracts/platform/mod.ts";

import { type CoreSession, openSession, type StreamFetch } from "./client.ts";
import {
  type Clock,
  type EventSink,
  type SocketFactory,
  subscribe,
} from "./events.ts";
import type { RestorePipe } from "./restore.ts";
import { type IpcEvent } from "../ipc-guard.ts";
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
  /** 테스트가 가짜 core를 끼운다. */
  start?: (options: LaunchOptions) => CoreProcess;
  /** main이 직접 보는 지금 도착한 event(OS notification). renderer로 나가지 않는다. */
  arrived?: EventSink["arrived"];
}

export interface ConnectionState {
  state:
    | "starting"
    | "ready"
    | "stale"
    | "failed"
    | "failed-start"
    | "failed-sandbox"
    | "failed-schema";
  confirmedAt: number | null;
}

export interface CoreConnection {
  readonly state: ConnectionState;
  /** 준비된 인증 read·command session. 준비 전에는 null이다. */
  session(): CoreSession | null;
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
  /** backup 복원 pipe(shell#T58). supervise.ts의 CoreProcess를 그대로 받는다. */
  restorePipe(): RestorePipe;
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

  // hello 하나에 session·구독을 연다. 복원 뒤 core가 같은 pipe로 보내는 새 hello에도
  // 같은 값(새 epoch·token·port)으로 다시 연다(shell#T58).
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
    subscribe({
      session,
      epoch: hello.core_epoch,
      // token은 이 closure에만 묶여 URL·renderer로 나가지 않는다.
      // Node의 WebSocket(undici)은 headers 옵션으로 Bearer를 싣는다.
      headers: () => ({ Authorization: `Bearer ${hello.user_token}` }),
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
        arrived: (events) => options.arrived?.(events),
      },
    });
  };

  core.hello.then(greet).catch(() => {
    state.state = "failed-start";
    push();
  });

  // 복원으로 멈춘 core는 같은 pipe의 새 hello(새 epoch·token·port)로 다시 시작한다. hello는
  // supervise.ts의 onMessage listener로 온다. session과 구독을 새 값으로 다시 연다.
  core.onMessage((payload) => {
    const message = payload as {
      type?: unknown;
      user_token?: unknown;
      api_port?: unknown;
      core_epoch?: unknown;
    };
    if (
      message.type === "hello" &&
      typeof message.user_token === "string" &&
      typeof message.api_port === "number" &&
      typeof message.core_epoch === "string"
    ) {
      greet({
        user_token: message.user_token,
        api_port: message.api_port,
        core_epoch: message.core_epoch,
      });
    }
  });

  // 새로 구독하는 renderer(런처로 돌아옴·창 다시 읽기)는 지금 상태를 한 번 묻는다. push는
  // 상태가 바뀔 때와 창이 load를 끝낼 때뿐이라 이미 지난 상태는 이 답으로만 받는다.
  options.ipc.handle(
    CORE_STATE_GET_CHANNEL,
    () => Promise.resolve({ ...state }),
  );

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
    session() {
      return session ?? null;
    },
    shutdown() {
      core.stop();
    },
    diagnostic(message) {
      return core.diagnostic(message);
    },
    /** backup 복원 pipe(shell#T58). supervise.ts의 CoreProcess를 그대로 받는다. */
    restorePipe(): RestorePipe {
      return {
        get phase() {
          return core.phase;
        },
        restore: (message: unknown) => core.restore(message),
        confirmation: (message: unknown) => core.confirmation(message),
        onMessage: (listener: (payload: unknown) => void) =>
          core.onMessage(listener),
      };
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
