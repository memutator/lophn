// event는 seq cursor로 잇는다. 끊기면 마지막 확인 시각을 남기고, 다시 붙으면
// epoch를 확인한 뒤 cursor 다음부터 따라잡는다. epoch가 바뀌면 옛 응답을 버린다.
import {
  EVENT_SUBSCRIBE_PATH,
  EVENT_SUBSCRIBE_SUBPROTOCOL,
  eventsList,
  parseEventFrame,
} from "../../../../../packages/contracts/platform/mod.ts";
import { nextFromSeq } from "../../../../../packages/base/mod.ts";

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
}

export interface EventSocket {
  send(text: string): void;
  close(): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
}

export interface SocketFactory {
  /** token은 factory 안에만 있고 이 인자에 실리지 않는다. */
  open(url: string, protocol: string): EventSocket;
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
  sink: EventSink;
  clock: Clock;
  /** core를 다시 띄우면 올린다. 낮은 generation의 늦은 응답은 버린다. */
  generation?: number;
}

/** renderer로 나가지 않는 구독. */
export function subscribe(options: SubscribeOptions): Subscription {
  const generation = options.generation ?? 1;
  let cursor = "0";
  let confirmedAt: number | null = null;
  let stopped = false;
  let socket: EventSocket | undefined;
  // 따라잡기 도중 도착한 더 낮은 generation의 응답을 거른다.
  let active = generation;

  const stale = () => {
    if (stopped) return;
    options.sink.stale({ state: "stale", confirmedAt });
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
    socket = options.socket.open(
      `ws://127.0.0.1:${options.session.apiPort}${EVENT_SUBSCRIBE_PATH}`,
      EVENT_SUBSCRIBE_SUBPROTOCOL,
    );
    socket.onMessage((text) => {
      if (stopped || mine !== active) return;
      const frame = parseEventFrame(text);
      if (!frame.ok || frame.value.type === "ack") return;
      if (frame.value.type !== "events") {
        if (frame.value.type === "unavailable") stale();
        return;
      }
      cursor = frame.value.scanned_through_seq;
      confirmedAt = options.clock.now();
    });
    socket.onClose(() => {
      if (mine !== active) return;
      socket = undefined;
      stale();
    });
    socket.send(JSON.stringify({
      type: "subscribe",
      from_seq: from.value,
      types: [],
      subjects: [],
    }));
  };

  attach(options.epoch);

  return {
    get cursor() {
      return cursor;
    },
    generation,
    reconnect(epoch) {
      if (stopped) return;
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
      active += 1;
      socket?.close();
    },
  };
}
