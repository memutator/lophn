import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  type AckFrame,
  authenticatedContextSchema,
  EVENT_BATCH_LIMITS,
  EVENT_CLOSE_CREDENTIAL_REVOKED,
  EVENT_CLOSE_SLOW_CONSUMER,
  eventsFrameSchema,
  idSchema,
  type RequestContext,
  seqSchema,
  type SubscribeFrame,
  subscribeFrameSchema,
} from "../../contracts/platform/mod.ts";
import { type EventBatch, type EventScan, frameBytes } from "./events.ts";
import { validateOutput } from "./output.ts";
import type { SubscriptionStore } from "./subscription-store.ts";

export type EventBackend = {
  current(credentialRef: string): Promise<Result<RequestContext>>;
  read(ctx: RequestContext, scan: EventScan): Promise<Result<EventBatch>>;
};
export type EventSink = {
  send(text: string): Promise<void>;
  close(code: number): void;
};
export type EventSession = {
  catchUp(): void;
  ack(ctx: RequestContext, frame: AckFrame): Promise<Result<void>>;
  close(): void;
  bufferedBytes(): number;
};
export type SubscribeStart = Omit<SubscribeFrame, "from_seq"> & {
  from_seq?: string;
};
const BUFFER_BYTES = 1024 * 1024;
const invalid = () =>
  err({
    code: "invalid_input" as const,
    message: "event 요청이 올바르지 않다",
  });
const unavailable = () =>
  err({ code: "unavailable" as const, message: "event 구독을 사용할 수 없다" });

// 명시 from은 그 순번을 포함한다. 이름만 있으면 저장 ack 다음, 둘 다 없으면 invalid다.
export async function resolveSubscriptionStart(
  ctx: RequestContext,
  start: SubscribeStart,
  store?: SubscriptionStore,
): Promise<Result<string>> {
  if (start.from_seq !== undefined) {
    return seqSchema.safeParse(start.from_seq).success
      ? ok(start.from_seq)
      : invalid();
  }
  if (!start.subscriber) return invalid();
  if (!store) return unavailable();
  const saved = await store.get(ctx.principal, start.subscriber);
  if (!saved.ok) return saved;
  const next = saved.value === null
    ? "0"
    : (BigInt(saved.value) + 1n).toString();
  return seqSchema.safeParse(next).success ? ok(next) : invalid();
}

export async function createEventSession(
  claimed: RequestContext,
  start: SubscribeStart,
  backend: EventBackend,
  sink: EventSink,
  store?: SubscriptionStore,
): Promise<Result<EventSession>> {
  if (!subscribeFrameSchema.safeParse(start).success) return invalid();
  try {
    const current = await backend.current(claimed.credential_ref);
    if (!current.ok) return unavailable();
    const parsed = validateOutput(
      authenticatedContextSchema.extend({ run: idSchema("run").optional() }),
      current.value,
    );
    if (
      !parsed.ok || parsed.value.principal !== claimed.principal ||
      parsed.value.actor !== claimed.actor ||
      parsed.value.credential_ref !== claimed.credential_ref
    ) return unavailable();
  } catch {
    return unavailable();
  }
  const position = await resolveSubscriptionStart(claimed, start, store);
  if (!position.ok) return position;
  let from = position.value;
  let closed = false;
  let reading = false;
  let sending = false;
  let requested = false;
  let bytes = 0;
  let observed: string | null = null;
  let acknowledged = "0";
  let acknowledging = false;
  const queue: {
    text: string;
    bytes: number;
    through: string;
    context: string;
  }[] = [];

  function end(code: number) {
    if (closed) return;
    closed = true;
    queue.length = 0;
    bytes = 0;
    try {
      sink.close(code);
    } catch { /* transport is already closed */ }
  }
  function fail() {
    if (closed) return;
    // held sink가 있으면 마지막 frame도 기다리지 않는다.
    if (!sending) {
      try {
        void sink.send(
          JSON.stringify({
            type: "unavailable",
            message: "event 구독을 사용할 수 없다",
          }),
        ).catch(() => undefined);
      } catch { /* close still follows */ }
    }
    end(EVENT_CLOSE_SLOW_CONSUMER);
  }
  async function current(): Promise<RequestContext | null> {
    try {
      const result = await backend.current(claimed.credential_ref);
      if (closed) return null;
      if (!result.ok) {
        if (
          result.error.code === "unauthorized" ||
          result.error.code === "forbidden"
        ) end(EVENT_CLOSE_CREDENTIAL_REVOKED);
        else fail();
        return null;
      }
      const parsed = validateOutput(
        authenticatedContextSchema.extend({ run: idSchema("run").optional() }),
        result.value,
      );
      if (
        !parsed.ok || parsed.value.principal !== claimed.principal ||
        parsed.value.credential_ref !== claimed.credential_ref ||
        parsed.value.actor !== claimed.actor
      ) {
        fail();
        return null;
      }
      return parsed.value;
    } catch {
      fail();
      return null;
    }
  }
  async function send() {
    if (sending || closed) return;
    sending = true;
    try {
      while (queue.length && !closed) {
        const ctx = await current();
        if (!ctx || closed) break;
        const item = queue.shift()!;
        if (canonicalize(ctx) !== item.context) {
          fail();
          break;
        }
        await sink.send(item.text);
        if (closed) break;
        bytes -= item.bytes;
        observed = item.through;
      }
    } catch {
      fail();
    } finally {
      sending = false;
    }
  }
  async function replay() {
    if (reading || closed) return;
    reading = true;
    try {
      do {
        requested = false;
        const ctx = await current();
        if (!ctx || closed) break;
        const result = await backend.read(ctx, {
          position: from,
          inclusive: true,
          types: start.types,
          subjects: start.subjects,
          limit: start.limit,
        });
        if (closed) break;
        if (!result.ok) {
          fail();
          break;
        }
        const parsed = validateOutput(eventsFrameSchema, {
          type: "events",
          ...result.value,
        });
        if (
          !parsed.ok || parsed.value.events.length > EVENT_BATCH_LIMITS.count ||
          frameBytes(result.value) > EVENT_BATCH_LIMITS.bytes
        ) {
          fail();
          break;
        }
        const batch = parsed.value;
        const previous = BigInt(from) > 0n ? BigInt(from) - 1n : 0n;
        const lower = previous > BigInt(batch.head_seq)
          ? BigInt(batch.head_seq)
          : previous;
        if (
          BigInt(batch.scanned_through_seq) < lower ||
          BigInt(batch.scanned_through_seq) > BigInt(batch.head_seq) ||
          batch.events.some((event, index) =>
            BigInt(event.seq) < BigInt(from) ||
            BigInt(event.seq) > BigInt(batch.scanned_through_seq) ||
            (index > 0 &&
              BigInt(event.seq) <= BigInt(batch.events[index - 1].seq))
          )
        ) {
          fail();
          break;
        }
        if (
          !batch.events.length && BigInt(from) > BigInt(batch.head_seq) + 1n
        ) break;
        const text = JSON.stringify(batch);
        const size = new TextEncoder().encode(text).length;
        if (bytes + size > BUFFER_BYTES) {
          fail();
          break;
        }
        // caught-up wake도 head를 알리지만 요청 한 번당 한 frame만 더한다.
        queue.push({
          text,
          bytes: size,
          through: batch.scanned_through_seq,
          context: canonicalize(ctx),
        });
        bytes += size;
        void send();
        const next = BigInt(batch.scanned_through_seq) + 1n;
        if (
          next <= BigInt(from) &&
          BigInt(batch.scanned_through_seq) < BigInt(batch.head_seq)
        ) {
          fail();
          break;
        }
        if (next > BigInt(from)) from = next.toString();
        if (BigInt(batch.scanned_through_seq) < BigInt(batch.head_seq)) {
          requested = true;
        }
      } while (requested && !closed);
    } catch {
      fail();
    } finally {
      reading = false;
    }
  }
  const session: EventSession = {
    catchUp() {
      if (!closed) {
        requested = true;
        void replay();
      }
    },
    async ack(ctx, frame) {
      if (
        closed || acknowledging || observed === null || !store ||
        !start.subscriber || frame.subscriber !== start.subscriber ||
        ctx.principal !== claimed.principal ||
        ctx.credential_ref !== claimed.credential_ref ||
        !seqSchema.safeParse(frame.through_seq).success ||
        BigInt(frame.through_seq) > BigInt(observed) ||
        BigInt(frame.through_seq) < BigInt(acknowledged) ||
        BigInt(frame.through_seq) < BigInt(position.value)
      ) return invalid();
      acknowledging = true;
      try {
        if (!await current() || closed) return unavailable();
        const saved = await store.ack(
          claimed.principal,
          start.subscriber,
          frame.through_seq,
          position.value,
        );
        if (!saved.ok) return saved;
        if (closed) return unavailable();
        acknowledged = frame.through_seq;
        return ok(undefined);
      } catch {
        return unavailable();
      } finally {
        acknowledging = false;
      }
    },
    close() {
      end(1000);
    },
    bufferedBytes: () => bytes,
  };
  session.catchUp();
  return ok(session);
}

export function createEventDispatcher(
  schedule: (catchUp: () => void) => () => void,
) {
  const sessions = new Set<EventSession>();
  const catchUp = () => {
    for (const session of sessions) session.catchUp();
  };
  const cancel = schedule(catchUp);
  return {
    add(session: EventSession) {
      sessions.add(session);
      return () => sessions.delete(session);
    },
    wake: catchUp,
    catchUp,
    close() {
      cancel();
      for (const session of sessions) session.close();
      sessions.clear();
    },
  };
}
