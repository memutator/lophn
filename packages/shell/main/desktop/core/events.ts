// shell main은 사람 token 하나로 Gateway에 붙고 받은 frame을 renderer에 중계한다. 조건은 renderer들이 건
// 것과 main 자신의 것을 합쳐 `watch` frame 하나로 건다. replay가 없으므로 연결이 새로 붙을 때마다 조건을
// 다시 걸고, 서버가 보내는 `ready`를 renderer가 받아 snapshot부터 다시 읽는다. 한 renderer가 조건을 바꿔 건
// `watch`의 `ready`는 그 renderer에만 가고(서버가 watch마다 차례로 답한다), 새로 붙은 연결의 `ready`는 모두에게 간다. 끊기면 마지막 확인 시각을
// 남기고, 다시 붙는 일은 connection이 맡는다(끊긴 Gateway의 capability는 core가 이미 버렸다).
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

interface ConnectionNotice {
  state: "stale";
  /** 마지막 확인 시각. 한 번도 확인하지 못했으면 null. */
  confirmedAt: number | null;
}

interface GatewaySink {
  stale(notice: ConnectionNotice): void;
  /** 서버가 조건을 적용했다(`ready`). renderer는 이때 snapshot을 읽는다. */
  ready(): void;
  /** 서버가 보낸 모든 frame. renderer로 보낼 것은 sink가 가려 쓴다. `to`는 `ready`가 답한 watch를 건 renderer이고 없으면 모두다. */
  frame(frame: GatewayServerFrame, to?: number): void;
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

export interface Gateway {
  readonly generation: number;
  /** 이 renderer의 조건 전체를 바꾼다. 쓸 수 있는 조건이 없으면 그 renderer의 조건을 뺀다. */
  watch(owner: number, conditions: readonly unknown[]): void;
  /** 이 renderer의 조건을 뺀다(창이 닫혔다). */
  forget(owner: number): void;
  stop(): void;
}

interface GatewayOptions {
  session: CoreSession;
  socket: SocketFactory;
  /** open할 때 socket에 실을 header. token을 아는 caller가 준다. */
  headers?: () => Record<string, string>;
  /** main 자신의 조건. 연결을 걸 때마다 읽는다. */
  own: () => readonly EventCondition[];
  sink: GatewaySink;
  clock: Clock;
  /** 다시 붙을 때마다 올린다. 낮은 generation의 늦은 응답은 버린다. */
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
  // 끊김을 한 번만 알린다. 다시 붙는 일은 connection이 새 Gateway를 열며 한다.
  let down = false;
  // 낮은 generation의 늦은 callback을 거른다.
  let active = generation;

  // 보낸 watch를 건 renderer를 보낸 차례로 둔다. 서버가 같은 차례로 `ready`를 답한다. undefined는 연결을 새로 건 watch다.
  let asked: (number | undefined)[] = [];

  const sendWatch = (owner?: number) => {
    if (!opened || socket === undefined) return;
    asked.push(owner);
    socket.send(
      JSON.stringify({
        type: "watch",
        conditions: merged(options.own(), watchers),
      }),
    );
  };

  const stale = () => {
    if (stopped || down) return;
    down = true;
    opened = false;
    options.sink.stale({ state: "stale", confirmedAt });
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
      down = false;
      opened = true;
      asked = [];
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
      options.sink.frame(
        parsed.data,
        parsed.data.type === "ready" ? asked.shift() : undefined,
      );
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
      sendWatch(owner);
    },
    forget(owner) {
      if (watchers.delete(owner)) sendWatch(owner);
    },
    stop() {
      stopped = true;
      active += 1;
      socket?.close();
    },
  };
}
