// Expo Push HTTP API로 글을 나르는 sender. fetch는 인자로 받는다(전역 fetch를 부르지 않는다).
// 보내지 못한 글은 버린다: Inbox가 기록이라 queue를 두지 않는다.

import type { Clock } from "../../../base/mod.ts";
import type { PushMessage } from "./types.ts";

export type { PushMessage } from "./types.ts";

// feature module(runs)를 import하지 않으려고 core의 다른 module처럼 자기 timer 꼴을 둔다. runs의 Timers가 그대로 들어간다.
export type PushTimers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export type ExpoPushDeps = {
  fetch: typeof fetch;
  /** `remote.push` 값. 빈 문자열이면 push를 끈 것이고 fetch를 부르지 않는다. 보낼 때마다 읽는다. */
  url: () => string;
  clock: Clock;
  timers: PushTimers;
  onDeadToken(token: string): void;
};

export type ExpoPushSender = {
  send(message: PushMessage): Promise<"sent" | "dropped">;
  close(): void;
};

const BACKOFF_MS = [1000, 2000, 4000];
// Expo가 영수증을 준비하는 데 걸리는 시간. 이보다 일찍 물으면 아직 없다.
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_BATCH = 1000;

type Pending = { id: string; token: string; at: number };

// 일시 오류(네트워크, 429, 5xx)만 다시 시도한다.
class Transient extends Error {}

function receiptsUrl(sendUrl: string): string {
  return sendUrl.replace(/\/send$/, "/getReceipts");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createExpoPushSender(deps: ExpoPushDeps): ExpoPushSender {
  let closed = false;
  let pending: Pending[] = [];
  let receiptTimer: unknown = null;
  const sleeping = new Set<{ handle: unknown; wake: () => void }>();

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const entry = {
        handle: undefined as unknown,
        wake: () => {
          sleeping.delete(entry);
          resolve();
        },
      };
      entry.handle = deps.timers.set(entry.wake, ms);
      sleeping.add(entry);
    });
  }

  async function post(url: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Transient();
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Transient();
    }
    if (!response.ok) throw new Error(`push endpoint ${response.status}`);
    return await response.json();
  }

  function ticketOf(json: unknown): Record<string, unknown> | undefined {
    const data = isRecord(json) ? json.data : undefined;
    const ticket = Array.isArray(data) ? data[0] : data;
    return isRecord(ticket) ? ticket : undefined;
  }

  function errorOf(entry: Record<string, unknown>): unknown {
    return isRecord(entry.details) ? entry.details.error : undefined;
  }

  async function send(message: PushMessage): Promise<"sent" | "dropped"> {
    const url = deps.url();
    if (url === "" || closed) return "dropped";
    try {
      let json: unknown;
      for (let attempt = 0; ; attempt++) {
        try {
          json = await post(url, message);
          break;
        } catch (error) {
          if (!(error instanceof Transient) || attempt >= BACKOFF_MS.length) {
            return "dropped";
          }
          await sleep(BACKOFF_MS[attempt]!);
          if (closed) return "dropped";
        }
      }
      const ticket = ticketOf(json);
      if (ticket === undefined) return "dropped";
      if (ticket.status === "ok" && typeof ticket.id === "string") {
        pending.push({
          id: ticket.id,
          token: message.to,
          at: deps.clock.nowMs(),
        });
        scheduleReceipts();
        return "sent";
      }
      if (errorOf(ticket) === "DeviceNotRegistered") {
        deps.onDeadToken(message.to);
      }
      return "dropped";
    } catch {
      // 본문이 JSON이 아니거나 400처럼 다시 해도 안 되는 응답. send는 던지지 않는다.
      return "dropped";
    }
  }

  function scheduleReceipts(): void {
    if (receiptTimer !== null || pending.length === 0 || closed) return;
    const oldest = Math.min(...pending.map((one) => one.at));
    const wait = Math.max(0, oldest + RECEIPT_DELAY_MS - deps.clock.nowMs());
    receiptTimer = deps.timers.set(() => {
      receiptTimer = null;
      void checkReceipts();
    }, wait);
  }

  // 보낸 지 15분이 지난 ticket만 묻는다. 확인하든 실패하든 그 id는 목록에서 뺀다(다시 하지 않는다).
  async function checkReceipts(): Promise<void> {
    const cutoff = deps.clock.nowMs() - RECEIPT_DELAY_MS;
    const due = pending
      .filter((one) => one.at <= cutoff)
      .slice(0, RECEIPT_BATCH);
    const taken = new Set(due);
    pending = pending.filter((one) => !taken.has(one));
    scheduleReceipts();
    const url = deps.url();
    if (due.length === 0 || url === "") return;
    try {
      const json = await post(receiptsUrl(url), {
        ids: due.map((one) => one.id),
      });
      const data = isRecord(json) ? json.data : undefined;
      if (!isRecord(data)) return;
      for (const one of due) {
        const receipt = data[one.id];
        if (isRecord(receipt) && errorOf(receipt) === "DeviceNotRegistered") {
          deps.onDeadToken(one.token);
        }
      }
    } catch {
      // 영수증을 못 읽으면 버린다.
    }
  }

  return {
    send,
    close() {
      closed = true;
      if (receiptTimer !== null) deps.timers.clear(receiptTimer);
      receiptTimer = null;
      for (const entry of [...sleeping]) {
        deps.timers.clear(entry.handle);
        entry.wake();
      }
    },
  };
}
