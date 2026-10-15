// shell main은 사람 token 하나로 Gateway에 붙고 받은 frame을 renderer에 중계한다. 조건은 renderer들이 건
// 것과 main 자신의 것을 합쳐 `watch` frame 하나로 건다. replay가 없으므로 연결이 새로 붙을 때마다 조건을
// 다시 걸고, 서버가 보내는 `ready`를 renderer가 받아 snapshot부터 다시 읽는다. 끊기면 마지막 확인 시각을
// 남기고 backoff로 스스로 다시 붙는다. epoch가 바뀌면 옛 core의 연결은 버린다.
import {
  type EventCondition,
  eventConditionSchema,
  GATEWAY_PATH,
  GATEWAY_SUBPROTOCOL,
  type GatewayServerFrame,
  gatewayServerFrameSchema,
} from "../../../../protocol/events/mod.ts";

import type { CoreSession } from "./client.ts";

export interface Clock {
  /** 주입한 시각(epoch ms). 테스트가 고정한다. */
  now(): number;
}

export interface ConnectionNotice {
  state: "stale";
  /** 마지막 확인 시각. 한 번도 확인하지 못했으면 null. */
  confirmedAt: number | null;
}

export interface GatewaySink {
  stale(notice: ConnectionNotice): void;
  /** 서버가 조건을 적용했다(`ready`). renderer는 이때 snapshot을 읽는다. */
  ready(): void;
  /** 서버가 보낸 모든 frame. renderer로 보낼 것은 sink가 가려 쓴다. */
  frame(frame: GatewayServerFrame): void;
}

export interface EventSocket {
  send(text: string): void;
  close(): void;
  /** socket이 open되면 부른다. watch는 open 뒤에 보낸다. */
  onOpen(listener: () => void): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
}

export interface SocketFactory {
  /**
   * Gateway socket을 연다. header는 token을 아는 caller가 closure로 묶어 함께 준다.
   * token은 URL에 실지 않는다.
   */
  open(
    url: string,
    protocol: string,
    headers?: Record<string, string>,
  ): EventSocket;
}

/** 끊긴 연결을 다시 잇는 시각 정책. 주입하지 않으면 다시 잇지 않는다. */
export interface ReconnectPolicy {
  /** 0부터 세는 연속 실패 횟수에 대한 대기 ms. */
  delay(attempt: number): number;
  /** ms 뒤에 run을 부른다. 돌려받은 함수로 취소한다. */
  after(ms: number, run: () => void): () => void;
  /** 다시 붙을 만한가. core 프로세스가 끝났으면 false다. */
  allowed?(): boolean;
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

/** 1s에서 15s까지 두 배씩 늘리고 그 뒤로는 15s마다 시도한다. */
export function backoffReconnect(
  allowed?: () => boolean,
): ReconnectPolicy {
  return {
    delay: (attempt) =>
      RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!,
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    ...(allowed ? { allowed } : {}),
  };
}

export interface Gateway {
  readonly generation: number;
  /** 이 renderer의 조건 전체를 바꾼다. 쓸 수 있는 조건이 없으면 그 renderer의 조건을 뺀다. */
  watch(owner: number, conditions: readonly unknown[]): void;
  /** 이 renderer의 조건을 뺀다(창이 닫혔다). */
  forget(owner: number): void;
  /** 끊긴 연결을 다시 잇는다. epoch가 다르면 옛 core의 것이라 붙지 않는다. */
  reconnect(epoch: string): void;
  stop(): void;
}

export interface GatewayOptions {
  session: CoreSession;
  /** hello로 받은 epoch. reconnect가 다른 epoch를 받으면 버린다. */
  epoch: string;
  socket: SocketFactory;
  /** open할 때 socket에 실을 header. token을 아는 caller가 준다. */
  headers?: () => Record<string, string>;
  /** main 자신의 조건. 연결을 걸 때마다 읽는다. */
  own: () => readonly EventCondition[];
  sink: GatewaySink;
  clock: Clock;
  /** 끊기면 같은 epoch로 스스로 다시 붙는다. 없으면 reconnect()를 부를 때만 다시 붙는다. */
  reconnectPolicy?: ReconnectPolicy;
  /** core를 다시 띄우면 올린다. 낮은 generation의 늦은 응답은 버린다. */
  generation?: number;
}

/** main 조건에 renderer들의 조건을 더해 같은 조건은 한 번만 건다. */
function merged(
  own: readonly EventCondition[],
  watchers: ReadonlyMap<number, readonly EventCondition[]>,
): EventCondition[] {
  const seen = new Set<string>();
  const out: EventCondition[] = [];
  for (const condition of [...own, ...[...watchers.values()].flat()]) {
    const key = JSON.stringify([condition.session ?? null, condition.types]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(condition);
  }
  return out;
}

export function openGateway(options: GatewayOptions): Gateway {
  const generation = options.generation ?? 1;
  const watchers = new Map<number, readonly EventCondition[]>();
  let confirmedAt: number | null = null;
  let stopped = false;
  let socket: EventSocket | undefined;
  let opened = false;
  // 낮은 generation의 늦은 callback을 거른다.
  let active = generation;

  let attempts = 0;
  let cancelRetry: (() => void) | undefined;

  const sendWatch = () => {
    if (!opened || socket === undefined) return;
    socket.send(JSON.stringify({
      type: "watch",
      conditions: merged(options.own(), watchers),
    }));
  };

  const scheduleRetry = () => {
    const policy = options.reconnectPolicy;
    if (stopped || policy === undefined || cancelRetry !== undefined) return;
    const run = () => {
      cancelRetry = undefined;
      if (stopped || policy.allowed?.() === false) return;
      socket?.close();
      socket = undefined;
      active += 1;
      connect();
    };
    cancelRetry = policy.after(policy.delay(attempts), run);
    attempts += 1;
  };

  const stale = () => {
    if (stopped) return;
    opened = false;
    options.sink.stale({ state: "stale", confirmedAt });
    scheduleRetry();
  };

  const clearRetry = () => {
    cancelRetry?.();
    cancelRetry = undefined;
  };

  const connect = () => {
    if (stopped) return;
    const mine = active;
    let current: EventSocket;
    try {
      current = options.socket.open(
        `ws://127.0.0.1:${options.session.apiPort}${GATEWAY_PATH}`,
        GATEWAY_SUBPROTOCOL,
        options.headers?.(),
      );
    } catch {
      socket = undefined;
      stale();
      return;
    }
    socket = current;
    current.onOpen(() => {
      if (stopped || mine !== active) return;
      // 붙었으니 다음에 끊기면 처음 대기부터 센다.
      attempts = 0;
      opened = true;
      // open되기 전에는 send하지 않는다. 붙을 때마다 조건을 다시 건다.
      sendWatch();
    });
    current.onMessage((text) => {
      if (stopped || mine !== active) return;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return;
      }
      const parsed = gatewayServerFrameSchema.safeParse(json);
      if (!parsed.success) return;
      confirmedAt = options.clock.now();
      if (parsed.data.type === "ready") options.sink.ready();
      options.sink.frame(parsed.data);
    });
    current.onClose(() => {
      if (mine !== active) return;
      if (socket === current) socket = undefined;
      stale();
    });
  };

  connect();

  return {
    generation,
    watch(owner, conditions) {
      const usable = conditions.flatMap((condition) => {
        const parsed = eventConditionSchema.safeParse(condition);
        return parsed.success ? [parsed.data] : [];
      });
      if (usable.length === 0) watchers.delete(owner);
      else watchers.set(owner, usable);
      sendWatch();
    },
    forget(owner) {
      if (watchers.delete(owner)) sendWatch();
    },
    reconnect(epoch) {
      if (stopped) return;
      clearRetry();
      socket?.close();
      socket = undefined;
      opened = false;
      active += 1;
      if (epoch === options.epoch) connect();
    },
    stop() {
      stopped = true;
      clearRetry();
      active += 1;
      socket?.close();
    },
  };
}
