// 후행 기록 전달 목록(apps/invocations#R5, R19). 앱 응답 뒤에 오는 기록 메시지를 유한한 메모리에
// 두고 core로 보낸다. 전체 4096 메시지 또는 8MiB 중 먼저 닿는 한도를 넘는 새 메시지는 버리고
// 손실로 센다(앱 업무와 응답은 막지 않는다). unavailable만 1·2·4초부터 최대 30초 backoff로 다시
// 보내고, unauthorized·conflict·invalid_input 같은 실패는 반복하지 않고 손실로 센다.
// 같은 (inv ID, 사실)은 한 메시지이고 한 호출의 start가 끝나기 전에는 그 finish·deny를 보내지 않는다.
// 시간은 clock으로 보고 다음에 깨울 때를 wake로 알린다. timer를 직접 쥐지 않아 시험이 시간을 건넌다.
import type { Clock } from "../../../base/mod.ts";
import {
  INVOCATION_DELIVERY_MAX_BYTES,
  INVOCATION_DELIVERY_MAX_MESSAGES,
} from "../../../contracts/apps/mod.ts";
import { deliveryKey, type RecordedFact } from "../recording.ts";
import { deliveryBackoffMs, retryable } from "./backoff.ts";

export type DeliveryMessage = {
  invocation: string;
  fact: RecordedFact;
  app: string;
  // core command 입력으로 바뀌기 전의 사실. 큐는 내용을 해석하지 않는다.
  body: unknown;
};

export type DeliveryOutcome = { ok: true } | { ok: false; code: string };

// 손실 진단의 안전한 payload다. 메시지 내용이나 오류 원문은 없다.
export type LossReport = {
  app: string;
  lost_messages: number;
  lost_bytes: number;
  first_lost_at: string;
  reason: "memory_limit" | "non_retryable_error";
};

export type DeliveryLimits = { messages: number; bytes: number };

export const DEFAULT_DELIVERY_LIMITS: DeliveryLimits = {
  messages: INVOCATION_DELIVERY_MAX_MESSAGES,
  bytes: INVOCATION_DELIVERY_MAX_BYTES,
};

// 손실 진단을 묶어 내는 최소 간격이다. 한도 초과가 이어져도 진단 폭주를 만들지 않는다.
export const LOSS_REPORT_INTERVAL_MS = 1000;

export type DeliveryQueueDeps = {
  send(message: DeliveryMessage): Promise<DeliveryOutcome>;
  clock: Clock;
  report(loss: LossReport): void;
  // 다음에 pump를 불러야 할 때까지의 ms. 운영은 setTimeout으로 pump를 부른다.
  wake?(delayMs: number): void;
  limits?: DeliveryLimits;
};

export type DeliveryQueue = {
  enqueue(message: DeliveryMessage): "queued" | "duplicate" | "lost";
  // 지금 보낼 수 있는 메시지를 모두 보낸다. 겹쳐 불러도 전송은 한 번에 하나다.
  pump(): Promise<void>;
  size(): { messages: number; bytes: number };
  // 묶어 둔 손실 진단을 지금 낸다.
  flushLoss(): void;
};

type Entry = {
  message: DeliveryMessage;
  bytes: number;
  attempts: number;
  dueMs: number;
};

type Loss = {
  app: string;
  reason: LossReport["reason"];
  messages: number;
  bytes: number;
  firstLostAt: string;
};

const encoder = new TextEncoder();

function weigh(message: DeliveryMessage): number {
  return encoder.encode(JSON.stringify(message)).length;
}

export function createDeliveryQueue(deps: DeliveryQueueDeps): DeliveryQueue {
  const limits = deps.limits ?? DEFAULT_DELIVERY_LIMITS;
  const entries = new Map<string, Entry>();
  const losses = new Map<string, Loss>();
  let bytes = 0;
  // active는 순회 중인지, running은 그 순회가 끝나길 기다리는 handle이다. 순회가 첫 await 전에
  // 끝나도 active가 먼저 내려가므로 다음 pump가 새로 시작한다.
  let active = false;
  let running: Promise<void> | undefined;
  let again = false;
  let lastFlushMs = Number.NEGATIVE_INFINITY;

  function lose(
    message: DeliveryMessage,
    size: number,
    reason: LossReport["reason"],
  ): void {
    const key = `${message.app}|${reason}`;
    const known = losses.get(key);
    if (known) {
      known.messages += 1;
      known.bytes += size;
    } else {
      losses.set(key, {
        app: message.app,
        reason,
        messages: 1,
        bytes: size,
        firstLostAt: deps.clock.now(),
      });
    }
  }

  function flushLoss(): void {
    lastFlushMs = deps.clock.nowMs();
    const pending = [...losses.values()];
    losses.clear();
    for (const loss of pending) {
      deps.report({
        app: loss.app,
        lost_messages: loss.messages,
        lost_bytes: loss.bytes,
        first_lost_at: loss.firstLostAt,
        reason: loss.reason,
      });
    }
  }

  // 한 번에 몰린 손실은 간격마다 한 번으로 묶어 낸다.
  function flushLossIfDue(): void {
    if (losses.size === 0) return;
    const wait = LOSS_REPORT_INTERVAL_MS - (deps.clock.nowMs() - lastFlushMs);
    if (wait <= 0) flushLoss();
    else deps.wake?.(wait);
  }

  function eligible(now: number): [string, Entry] | undefined {
    for (const [key, entry] of entries) {
      if (entry.dueMs > now) continue;
      // 한 호출의 시작이 아직 목록에 있으면 그 종료 사실은 순서를 기다린다.
      if (
        entry.message.fact !== "start" &&
        entries.has(deliveryKey(entry.message.invocation, "start"))
      ) continue;
      return [key, entry];
    }
    return undefined;
  }

  function wakeForNext(): void {
    if (entries.size === 0) return;
    const now = deps.clock.nowMs();
    let soonest = Number.POSITIVE_INFINITY;
    for (const entry of entries.values()) {
      if (entry.dueMs > now && entry.dueMs < soonest) soonest = entry.dueMs;
    }
    if (soonest !== Number.POSITIVE_INFINITY) deps.wake?.(soonest - now);
  }

  function drop(key: string, entry: Entry): void {
    entries.delete(key);
    bytes -= entry.bytes;
  }

  async function drain(): Promise<void> {
    active = true;
    try {
      do {
        again = false;
        while (true) {
          const next = eligible(deps.clock.nowMs());
          if (next === undefined) break;
          const [key, entry] = next;
          let outcome: DeliveryOutcome;
          try {
            outcome = await deps.send(entry.message);
          } catch {
            outcome = { ok: false, code: "unavailable" };
          }
          // 보내는 동안 같은 key가 바뀔 수 없다(enqueue는 duplicate로 끝난다).
          if (outcome.ok) {
            drop(key, entry);
          } else if (retryable(outcome.code)) {
            entry.attempts += 1;
            entry.dueMs = deps.clock.nowMs() +
              deliveryBackoffMs(entry.attempts);
          } else {
            drop(key, entry);
            lose(entry.message, entry.bytes, "non_retryable_error");
          }
        }
      } while (again);
    } finally {
      active = false;
    }
    flushLossIfDue();
    wakeForNext();
  }

  // 이미 보내는 중이면 그 순회가 끝날 때까지 기다리게 하고 새로 시작하지 않는다.
  function pump(): Promise<void> {
    if (active) {
      again = true;
      return running ?? Promise.resolve();
    }
    running = drain();
    return running;
  }

  return {
    enqueue(message) {
      const key = deliveryKey(message.invocation, message.fact);
      if (entries.has(key)) return "duplicate";
      const size = weigh(message);
      if (
        entries.size + 1 > limits.messages || bytes + size > limits.bytes
      ) {
        lose(message, size, "memory_limit");
        flushLossIfDue();
        return "lost";
      }
      entries.set(key, {
        message,
        bytes: size,
        attempts: 0,
        dueMs: deps.clock.nowMs(),
      });
      bytes += size;
      return "queued";
    },
    pump,
    size: () => ({ messages: entries.size, bytes }),
    flushLoss,
  };
}
