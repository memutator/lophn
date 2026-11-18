// core 연결. core는 shell의 child가 아니다. ensure로 띄우거나 붙은 뒤에는 control socket이 준
// 사람 token과 shell capability로만 움직인다. 둘 다 이 파일의 메모리에만 둔다.
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
import { confirmationHandleRegisterSchema } from "../../../../protocol/base/mod.ts";
import {
  controlDiagnosticSchema,
  type Diagnostic,
  type StartFailureReason,
} from "../../../../protocol/supervision/mod.ts";

import {
  type CallResult,
  type CoreSession,
  openSession,
  type StreamFetch,
} from "./client.ts";
import {
  type Clock,
  type Gateway,
  openGateway,
  type SocketFactory,
} from "./events.ts";
import type { IpcEvent } from "../ipc-guard.ts";
import {
  type ShellLaunch,
  openShellCoreControl,
  type ShellCoreControl,
} from "./supervise.ts";

interface StateTarget {
  /** webContents id. `watch`를 건 renderer(sender id)와 같다. */
  id: number;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
}

interface CoreIpc {
  handle(
    channel: string,
    listener: (event: unknown, input: unknown) => Promise<unknown>,
  ): void;
}

interface ConnectionOptions {
  launch: ShellLaunch;
  /**
   * root package.json의 판. identify가 알린 판과 다르면 ensure가 core를 갈아 띄운다.
   * 읽지 못했으면 core를 띄우지 않고 failed-start로 둔다.
   */
  productVersion?: string;
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
  /**
   * main 자신이 보는 event. 조건은 renderer의 조건과 합쳐 건다. event는 renderer에도 같이 가지만
   * main이 먼저 쓴다.
   */
  own?: {
    conditions(): readonly EventCondition[];
    /** Gateway가 붙어 event가 다시 온다. 끊긴 동안 놓친 것이 있을 수 있어 main이 가진 사본을 다시 읽는다. */
    ready?(): void;
    event(event: BusEvent): void;
    /** 이 컴퓨터의 창이 부른 core 호출의 답. event가 따르지 않는 바뀜(이 기계의 이름)을 main이 따라간다. */
    called?(
      call: { kind: string; resource: string; method: string },
      reply: CallResult,
    ): void;
  };
}

type ConnectionState = ShellConnectionState;

export interface CoreConnection {
  readonly state: ConnectionState;
  /** 준비된 인증 read·command session. 준비 전에는 null이다. */
  session(): CoreSession | null;
  /** `/host-link`를 열 port와 사람 token header. 준비 전에는 null이다. */
  hostLinkTarget(): { apiPort: number; headers: Record<string, string> } | null;
  /** 닫힌 창(webContents id)의 구독 조건과 그 창의 미소비 handle을 버린다. */
  forget(owner: number, windowId?: string): void;
  /** shell이 끝난다. 연결과 Gateway만 정리하고 core는 그대로 둔다. */
  detach(): void;
  /** `Stop lophn`. reconnect를 먼저 멈추고 control stop이 답할 때까지 기다린다. */
  stopCore(): Promise<boolean>;
  /** main의 안전 진단을 control로 보낸다. contract 밖 메시지이거나 보낼 길이 없으면 false다. */
  diagnostic(message: unknown): boolean;
  /**
   * 사람 결정 handle을 shell capability로만 등록한다. 응답에 짝 id가 없으므로 한 번에 하나씩 보낸다.
   */
  registerConfirmation(
    request: unknown,
  ): Promise<
    | { ok: true; confirmation: string; expiresAt: string }
    | { ok: false; error: { code: string; message: string } }
  >;
  /**
   * `logins/release`를 부른다. shell capability는 이것과 `terminalCall`·`machineCall`만 입력에 싣고 값은 호출한 쪽(browser driver)에만 돌아간다.
   * origin은 부르는 쪽이 ref 요소가 든 frame에서 잰 값이다.
   */
  releaseLogin(request: {
    id: string;
    field: "password" | "totp";
    origin: string;
  }): Promise<
    | { ok: true; value: { value: string } }
    | { ok: false; error: { code: string; message: string } }
  >;
  /**
   * 사람의 터미널 입력과 다시 시작(`terminals/input`·`restart`)을 shell capability를 실어 부른다. 그 창이 그 터미널에 focus를
   * 가졌는지는 부르는 쪽(터미널 wiring)이 먼저 본다.
   */
  terminalCall(
    method: "input" | "restart",
    body: Record<string, unknown>,
  ): Promise<
    | { ok: true; value: unknown }
    | { ok: false; error: { code: string; message: string } }
  >;
  /**
   * 다른 기계를 부른다(`machines/call`·`watch`). core는 shell capability가 있는 호출만 넘긴다: 받는 기계는 이 컴퓨터를 사람으로
   * 보므로 사람의 CLI token이 이 길을 타지 못하게 한다.
   */
  machineCall(
    method: "call" | "watch",
    body: Record<string, unknown>,
  ): Promise<
    | { ok: true; value: unknown }
    | { ok: false; error: { code: string; message: string } }
  >;
}

/** Gateway가 끊긴 뒤 다시 붙기까지의 대기. 곧바로 실패하는 연결이 core를 두드리지 않게 한다. */
const RECOVER_DELAY_MS = 1_000;
/** Gateway ready 뒤 이 시간 안에 끝나는 core를 crash로 센다. 이보다 오래 산 core는 센 수를 0으로 돌린다. */
const STABLE_MS = 60_000;
/** crash가 이만큼 이어지면 shell이 다시 띄우지 않고 failed-start에 멈춘다. */
const RESTART_LIMIT = 5;
/** 다른 client가 core를 멈춘 뒤 새 core가 섰는지 묻는 간격. 묻기만 하고 띄우지 않는다. */
const SHUTDOWN_PROBE_MS = 30_000;

/** main 조립이 부른다. 준비 전에 창은 이미 열려 있다. */
export function startCoreConnection(
  options: ConnectionOptions,
): CoreConnection {
  const state: ConnectionState = { state: "starting", confirmedAt: null };
  const push = () => {
    for (const target of options.targets?.() ?? []) {
      if (!target.isDestroyed()) target.send(CORE_STATE_CHANNEL, { ...state });
    }
  };

  const opened =
    options.productVersion === undefined
      ? undefined
      : openShellCoreControl({
          launch: options.launch,
          productVersion: options.productVersion,
        });
  const control = opened !== undefined && opened.ok ? opened.value : undefined;
  if (control === undefined) {
    state.state = "failed-start";
    push();
  }

  // renderer들이 건 조건. Gateway가 붙기 전에 온 것도 여기 남았다가 붙을 때 건다.
  const watching = new Map<number, unknown[]>();
  let attached:
    | {
        session: CoreSession;
        capability: string;
        gateway: Gateway;
        userToken: string;
      }
    | undefined;
  // 다시 붙을 때마다 올려 낮은 generation의 늦은 socket callback을 거른다.
  let generation = 0;
  // shell이 끝나거나 `Stop lophn`을 시작했다. 다시 띄우지 않는다.
  let stopped = false;
  // 다른 client가 control stop을 보냈다(`closed(shutdown)`). 저절로 다시 띄우지 않는다.
  let shutdownSeen = false;
  // shutdownSeen 동안 새 core(CLI가 다시 띄운 것)가 섰는지 묻는 timer.
  let probe: ReturnType<typeof setInterval> | undefined;
  // 이어진 짧은 crash 수와 마지막 ready 시각. Retry(attachIfAlive)는 수를 비우지 않는다.
  let crashes = 0;
  let readyAt: number | undefined;
  // Quit·`Stop lophn`이 돌던 ensure가 core를 새로 띄우지 않게 끊는다.
  const controller = new AbortController();
  // ensure는 한 번에 하나만 돈다. renderer들이 같이 재연결해도 core를 두 번 띄우지 않는다.
  let recovering: Promise<void> | undefined;
  // handle 등록은 한 번에 하나씩 보낸다.
  let registering: Promise<unknown> = Promise.resolve();

  const relay = (message: CoreEventMessage, to?: number) => {
    for (const target of options.targets?.() ?? []) {
      if (to !== undefined && target.id !== to) continue;
      if (!target.isDestroyed()) target.send(CORE_EVENT_CHANNEL, message);
    }
  };

  function fail(reason?: StartFailureReason): void {
    state.confirmedAt = null;
    delete state.schemaFailure;
    if (reason !== undefined && reason !== "other") {
      state.state = "failed-schema";
      state.schemaFailure = reason;
    } else {
      state.state = "failed-start";
    }
    push();
  }

  // 다른 client가 core를 멈췄다. 죽은 연결을 비워 renderer의 호출(Reconnect)이 attachIfAlive로 가게 하고,
  // 사람이 누르지 않아도 새 core가 서면 붙도록 identify만 주기적으로 묻는다. 어느 쪽도 core를 띄우지 않는다.
  function shutdownObserved(): void {
    shutdownSeen = true;
    attached?.gateway.stop();
    attached = undefined;
    state.state = "stale";
    push();
    probe ??= setInterval(() => {
      if (stopped || !shutdownSeen) {
        clearInterval(probe);
        probe = undefined;
        return;
      }
      void attachIfAlive();
    }, SHUTDOWN_PROBE_MS);
  }

  function openCore(core: {
    api_url: string;
    core_epoch: string;
    user_token: string;
    shell_capability?: string;
  }): void {
    attached?.gateway.stop();
    const session = openSession({
      apiUrl: core.api_url,
      coreEpoch: core.core_epoch,
      userToken: core.user_token,
      fetch: options.fetch,
      ...(options.stream ? { stream: options.stream } : {}),
    });
    // shell connect의 결과에는 capability가 늘 있다. ensure가 그 계약을 확인한다.
    const capability = core.shell_capability!;
    generation += 1;
    const gateway = openGateway({
      session,
      generation,
      headers: () => ({
        Authorization: `Bearer ${core.user_token}`,
        // capability는 main 메모리에서 이 handshake로만 나간다. renderer·extension host env로는 가지 않는다.
        "x-lophn-shell-capability": capability,
      }),
      socket: options.sockets,
      clock: options.clock,
      own: () => options.own?.conditions() ?? [],
      sink: {
        stale: () => {
          if (shutdownSeen) return;
          state.state = "stale";
          push();
          if (
            readyAt !== undefined &&
            options.clock.now() - readyAt >= STABLE_MS
          ) {
            crashes = 0;
          }
          crashes += 1;
          readyAt = undefined;
          if (crashes >= RESTART_LIMIT) {
            // 죽은 연결을 비워 둬야 Retry(renderer의 core call)가 attachIfAlive로 간다.
            attached = undefined;
            fail();
            return;
          }
          setTimeout(
            () => void recover(),
            RECOVER_DELAY_MS * 2 ** (crashes - 1),
          );
        },
        ready: () => {
          // 창의 watch마다 ready가 오지만 상태와 main의 다시 읽기는 연결이 처음 확인될 때만 한다. 매번 하면 상태를 듣는 화면과 main이
          // 다시 읽어 시작의 읽기가 몰린다.
          const changed = state.state !== "ready" || state.confirmedAt === null;
          state.state = "ready";
          state.confirmedAt = options.clock.now();
          if (!changed) return;
          readyAt = state.confirmedAt;
          push();
          options.own?.ready?.();
        },
        // renderer에 가는 것은 ready·event·closed뿐이다.
        frame: (frame, to) => {
          if (frame.type === "ready") relay({ kind: "ready" }, to);
          else if (frame.type === "event") {
            options.own?.event(frame.event);
            // 다른 기계의 frame은 main이 그 기계의 창에만 나눠 보낸다(wiring/machines).
            if (frame.event.type !== "MachineFrameReceived") {
              relay({ kind: "event", event: frame.event });
            }
          } else if (frame.type === "closed") {
            relay({ kind: "closed", reason: frame.reason });
            // core가 내려간다는 frame이다. 이 shell은 core를 다시 띄우지 않는다.
            if (frame.reason === "shutdown") shutdownObserved();
          }
        },
      },
    });
    attached = { session, capability, gateway, userToken: core.user_token };
    shutdownSeen = false;
    state.state = "ready";
    state.confirmedAt = null;
    delete state.schemaFailure;
    push();
    for (const [owner, conditions] of watching) {
      gateway.watch(owner, conditions);
    }
  }

  async function attach(): Promise<void> {
    if (control === undefined) return;
    const ensured = await control.ensure(controller.signal);
    if (stopped) return;
    if (!ensured.ok) {
      fail(ensured.error.reason);
      return;
    }
    openCore(ensured.value);
  }

  // core를 띄울 수 있는 길(없으면 띄우고, 판이 다르면 갈아 띄운다). 동시 호출은 한 번으로 합친다.
  function recover(): Promise<void> {
    if (control === undefined || stopped || shutdownSeen) {
      return Promise.resolve();
    }
    if (recovering !== undefined) return recovering;
    const run = (async () => {
      // 다른 client가 core를 멈추는 중이면 다시 띄우지 않는다. `closed(shutdown)`을 놓친 경우도
      // 여기서 걸러 CLI `core stop`을 shell이 되살리지 않는다.
      const identified = await control.identify();
      if (stopped) return;
      if (identified.ok && identified.value.state === "stopping") {
        shutdownObserved();
        return;
      }
      state.state = "starting";
      push();
      await attach();
    })().finally(() => {
      recovering = undefined;
    });
    recovering = run;
    return run;
  }

  // core가 없을 때 renderer의 호출이 왔다. 이미 서 있는 core에만 붙고 띄우지는 않는다.
  // CLI `core stop`을 shell이 되살리는 loop를 만들지 않기 위해서다.
  async function attachIfAlive(): Promise<void> {
    if (stopped || attached !== undefined) return;
    if (recovering !== undefined) {
      await recovering;
      return;
    }
    if (control === undefined) return;
    if (state.state !== "stale") {
      // 시작 실패 화면의 Retry는 띄우는 길이다.
      await recover();
      return;
    }
    const joined = await control.join();
    if (stopped) return;
    if (joined.ok) openCore(joined.value);
  }

  // 새로 구독하는 renderer(런처로 돌아옴·창 다시 읽기)는 지금 상태를 한 번 묻는다. push는
  // 상태가 바뀔 때와 창이 load를 끝낼 때뿐이라 이미 지난 상태는 이 답으로만 받는다.
  options.ipc.handle(CORE_STATE_GET_CHANNEL, () =>
    Promise.resolve({ ...state }),
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
    attached?.gateway.watch(owner, parsed.data.conditions);
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
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "unavailable", message: "core가 준비되지 않았다" },
      };
    }
    if (attached === undefined) await attachIfAlive();
    if (attached === undefined) {
      return {
        ok: false,
        error: { code: "unavailable", message: "core가 준비되지 않았다" },
      };
    }
    const { kind, resource, method, body, bytes } = parsed.data;
    const reply = await attached.session.call(
      kind,
      resource,
      method,
      body,
      bytes,
    );
    options.own?.called?.({ kind, resource, method }, reply);
    return reply;
  });

  void recover();

  return {
    get state() {
      return state;
    },
    session() {
      return attached?.session ?? null;
    },
    // core의 `/host-link`는 shell capability를 보지 않으므로 사람 token만 싣는다.
    hostLinkTarget() {
      return attached === undefined
        ? null
        : {
            apiPort: attached.session.apiPort,
            headers: { Authorization: `Bearer ${attached.userToken}` },
          };
    },
    forget(owner, windowId) {
      watching.delete(owner);
      attached?.gateway.forget(owner);
      // 창이 닫히면 그 창이 받은 미소비 handle도 core에서 버린다.
      if (
        windowId !== undefined &&
        attached !== undefined &&
        control !== undefined
      ) {
        void control.closeWindow(attached.capability, windowId);
      }
    },
    detach() {
      stopped = true;
      clearInterval(probe);
      controller.abort();
      attached?.gateway.stop();
      attached = undefined;
    },
    async stopCore() {
      // 멈추는 동안의 reconnect는 core를 다시 띄우지 않는다.
      stopped = true;
      clearInterval(probe);
      controller.abort();
      attached?.gateway.stop();
      attached = undefined;
      if (control === undefined) return false;
      // 돌던 ensure가 이미 띄운 core는 ready가 된 뒤에야 stop이 닿는다.
      await recovering?.catch(() => {});
      const stoppedCore = await control.stop();
      // 끄기가 취소돼 shell이 살아 남아도 화면이 끊긴 core를 ready로 보이지 않게 한다.
      state.state = "stale";
      push();
      return stoppedCore.ok;
    },
    diagnostic(message) {
      if (stopped || control === undefined) return false;
      if (!controlDiagnosticSchema.safeParse(message).success) return false;
      void control.diagnostic(message as Diagnostic);
      return true;
    },
    async releaseLogin(request) {
      if (attached === undefined) {
        return {
          ok: false,
          error: { code: "unavailable", message: "core is not ready" },
        };
      }
      const released = await attached.session.internal(
        "memory",
        "logins",
        "release",
        { ...request, shell_capability: attached.capability },
      );
      return released as Awaited<ReturnType<CoreConnection["releaseLogin"]>>;
    },
    async terminalCall(method, body) {
      if (attached === undefined) {
        return {
          ok: false,
          error: { code: "unavailable", message: "core is not ready" },
        };
      }
      return (await attached.session.internal("memory", "terminals", method, {
        ...body,
        shell_capability: attached.capability,
      })) as Awaited<ReturnType<CoreConnection["terminalCall"]>>;
    },
    async machineCall(method, body) {
      if (attached === undefined) {
        return {
          ok: false,
          error: { code: "unavailable", message: "core is not ready" },
        };
      }
      return (await attached.session.internal("memory", "machines", method, {
        ...body,
        shell_capability: attached.capability,
      })) as Awaited<ReturnType<CoreConnection["machineCall"]>>;
    },
    registerConfirmation(request) {
      const run = () => registerOnce(control, attached, request);
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

async function registerOnce(
  control: ShellCoreControl | undefined,
  attached: { capability: string } | undefined,
  request: unknown,
): Promise<Registered> {
  if (control === undefined || attached === undefined) return NO_HANDLE;
  const parsed = confirmationHandleRegisterSchema.safeParse(request);
  if (!parsed.success) return NO_HANDLE;
  const issued = await control.register(attached.capability, parsed.data);
  if (!issued.ok) {
    return {
      ok: false,
      error: { code: issued.error.code, message: issued.error.message },
    };
  }
  return {
    ok: true,
    confirmation: issued.value.confirmation,
    expiresAt: issued.value.expires_at,
  };
}
