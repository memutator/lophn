// event는 seq cursor로 잇는다. 끊기면 마지막 확인 시각을 남기고 backoff로 스스로 다시 붙는다.
// 다시 붙으면 epoch를 확인한 뒤 cursor 다음부터 현재 기록으로 따라잡는다. epoch가 바뀌면 옛
// 응답을 버린다.
import {
  EVENT_SUBSCRIBE_PATH,
  EVENT_SUBSCRIBE_SUBPROTOCOL,
  type EventEnvelope,
  eventsList,
  nextFromSeq,
  parseEventFrame,
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

export interface EventSink {
  stale(notice: ConnectionNotice): void;
  caughtUp(): void;
  /**
   * socket으로 지금 도착한 event. 붙을 때·재연결 때 따라잡은 목록은 cursor만 옮기고 여기로
   * 보내지 않는다. 놓친 진행을 연속 재생하지 않는다(shell/desktop#R7).
   */
  arrived?(events: readonly EventEnvelope[]): void;
}

export interface EventSocket {
  send(text: string): void;
  close(): void;
  /** socket이 open되면 부른다. subscribe는 open 뒤에 보낸다. */
  onOpen(listener: () => void): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
}

export interface SocketFactory {
  /**
   * 구독 socket을 연다. header는 token을 아는 caller가 closure로 묶어 함께 준다.
   * token은 URL에 실지 않는다.
   */
  open(
    url: string,
    protocol: string,
    headers?: Record<string, string>,
  ): EventSocket;
}

/** 끊긴 구독을 다시 잇는 시각 정책. 주입하지 않으면 다시 잇지 않는다. */
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

export interface Subscription {
  readonly cursor: string;
  readonly generation: number;
  /** 끊긴 구독을 같은 cursor로 다시 잇는다. epoch가 다르면 아무것도 하지 않는다. */
  reconnect(epoch: string): void;
  stop(): void;
}

export interface SubscribeOptions {
  session: CoreSession;
  /** hello로 받은 epoch. 응답 epoch와 다르면 그 응답을 버린다. */
  epoch: string;
  socket: SocketFactory;
  /** open할 때 socket에 실 header. token을 아는 caller가 준다. */
  headers?: () => Record<string, string>;
  sink: EventSink;
  clock: Clock;
  /** 끊기면 같은 epoch로 스스로 다시 붙는다. 없으면 reconnect()를 부를 때만 다시 붙는다. */
  reconnectPolicy?: ReconnectPolicy;
  /** core를 다시 띄우면 올린다. 낮은 generation의 늦은 응답은 버린다. */
  generation?: number;
}

/** renderer로 나가지 않는 구독. */
export function subscribe(options: SubscribeOptions): Subscription {
  const generation = options.generation ?? 1;
  let cursor = "0";
  // 붙을 때 본 head. 이 seq까지는 따라잡기 backlog라 지금 도착한 것으로 보내지 않는다.
  let backlogThrough = 0n;
  let confirmedAt: number | null = null;
  let stopped = false;
  let socket: EventSocket | undefined;
  // 따라잡기 도중 도착한 더 낮은 generation의 응답을 거른다.
  let active = generation;

  let attempts = 0;
  let cancelRetry: (() => void) | undefined;

  const stale = () => {
    if (stopped) return;
    options.sink.stale({ state: "stale", confirmedAt });
    scheduleRetry();
  };

  // 끊긴 구독을 같은 epoch로 다시 붙인다. 붙으면 cursor 다음부터 현재 기록으로 맞추고
  // 끊긴 사이 진행은 재생하지 않는다(backlogThrough).
  const scheduleRetry = () => {
    const policy = options.reconnectPolicy;
    if (stopped || policy === undefined || cancelRetry !== undefined) return;
    const run = () => {
      cancelRetry = undefined;
      if (stopped || policy.allowed?.() === false) return;
      socket?.close();
      socket = undefined;
      active += 1;
      attach(options.epoch);
    };
    cancelRetry = policy.after(policy.delay(attempts), run);
    attempts += 1;
  };

  const clearRetry = () => {
    cancelRetry?.();
    cancelRetry = undefined;
  };

  const attach = (epoch: string) => {
    if (stopped || epoch !== options.epoch) return;
    const mine = active;
    void catchUp(mine, epoch);
  };

  const catchUp = async (mine: number, epoch: string) => {
    const page = await options.session.call("read", "events", "list", {
      after_seq: cursor,
    });
    if (stopped || mine !== active || epoch !== options.epoch) return;
    if (!page.ok) {
      stale();
      return;
    }
    const output = eventsList.output.safeParse(page.value);
    if (!output.success || mine !== active) {
      stale();
      return;
    }
    cursor = output.data.scanned_through_seq;
    backlogThrough = BigInt(output.data.head_seq);
    confirmedAt = options.clock.now();
    options.sink.caughtUp();
    openSocket(mine, epoch);
  };

  const openSocket = (mine: number, epoch: string) => {
    if (stopped || mine !== active || epoch !== options.epoch) return;
    const from = nextFromSeq(cursor);
    if (!from.ok) {
      stale();
      return;
    }
    let current: EventSocket;
    try {
      current = options.socket.open(
        `ws://127.0.0.1:${options.session.apiPort}${EVENT_SUBSCRIBE_PATH}`,
        EVENT_SUBSCRIBE_SUBPROTOCOL,
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
      // open되기 전에는 send하지 않는다. open 뒤에 구독을 보낸다.
      current.send(JSON.stringify({
        type: "subscribe",
        from_seq: from.value,
        types: [],
        subjects: [],
      }));
    });
    current.onMessage((text) => {
      if (stopped || mine !== active) return;
      const frame = parseEventFrame(text);
      if (!frame.ok || frame.value.type === "ack") return;
      if (frame.value.type !== "events") {
        if (frame.value.type === "unavailable") stale();
        return;
      }
      cursor = frame.value.scanned_through_seq;
      confirmedAt = options.clock.now();
      // 한 page로 다 따라잡지 못한 나머지도 socket으로 오므로 head 뒤의 것만 보낸다.
      const fresh = frame.value.events.filter((event) =>
        BigInt(event.seq) > backlogThrough
      );
      if (fresh.length > 0) options.sink.arrived?.(fresh);
    });
    current.onClose(() => {
      if (mine !== active) return;
      if (socket === current) socket = undefined;
      stale();
    });
  };

  attach(options.epoch);

  return {
    get cursor() {
      return cursor;
    },
    generation,
    reconnect(epoch) {
      if (stopped) return;
      clearRetry();
      socket?.close();
      socket = undefined;
      if (epoch !== options.epoch) {
        // 옛 core의 응답은 더 이상 받지 않는다.
        active += 1;
        return;
      }
      active += 1;
      attach(epoch);
    },
    stop() {
      stopped = true;
      clearRetry();
      active += 1;
      socket?.close();
    },
  };
}
