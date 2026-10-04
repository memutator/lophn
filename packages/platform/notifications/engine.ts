// core의 독립 비동기 루프가 notifications cursor부터 event batch를 읽고, 계기가
// 있으면 create_notification을, 없으면 cursor만 올린다(R1, R2). 본문 조립·OS 표시·
// model 호출은 하지 않는다(R8). 전달 실패로 버리지 않고 그 위치에서 멈춘다.

import { err, nextFromSeq, ok, type Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import { EVENT_BATCH_LIMITS } from "../../contracts/platform/mod.ts";
import { reactionIdempotencyKey } from "../ledger/mod.ts";
import type { EventBackend } from "../ledger/mod.ts";
import { NOTIFICATION_SUBSCRIBER } from "./commands.ts";
import { triggerOf } from "./model.ts";

export type NotificationsEngineCommand = (
  ctx: AuthenticatedContext,
  envelope: {
    command: string;
    input: unknown;
    idempotency_key: string;
    compare: unknown;
    prepared: readonly string[];
  },
) => Promise<Result<unknown>>;

export type NotificationsEngineOptions = {
  // ledger event를 읽는 통로. core의 reader backend다.
  backend: EventBackend;
  // create_notification과 AdvanceSubscriberCursor를 낸다. 등록·자격은 writer가 본다.
  command: NotificationsEngineCommand;
  machine: AuthenticatedContext;
  // 없으면 cursor 어디서부터인지 몰라 "0"부터 본다.
  cursor?: () => Promise<string>;
  // batch 한 페이지의 event 수. 기본은 contract 한도다.
  batch?: number;
};

export type NotificationsEngine = {
  // batch를 하나 읽고 계기마다 command를 낸다. 실패한 위치에서 멈추고 재시작은
  // 같은 cursor부터 다시 읽는다. scanned 위치를 돌려준다.
  step(): Promise<Result<string>>;
  close(): void;
};

// machine ctx는 생성과 cursor 전진 두 operation을 scope에 둔다.
export function notificationsMachineContext(
  base: AuthenticatedContext,
): AuthenticatedContext {
  return {
    ...base,
    scope: {
      ...base.scope,
      operations: [
        ...new Set([
          ...base.scope.operations,
          "create_notification",
          "AdvanceSubscriberCursor",
        ]),
      ],
    },
  };
}

// source event seq 하나가 notification id 하나가 된다. 숫자 seq를 고정 폭으로 바꾼다.
function notificationId(event: EventEnvelopeSeq): string {
  return `ntf_${event.toString(10).padStart(26, "0").slice(-26)}`;
}

type EventEnvelopeSeq = bigint;

export function notificationsEngine(
  options: NotificationsEngineOptions,
): NotificationsEngine {
  const { backend, command, machine } = options;
  const batch = options.batch ?? EVENT_BATCH_LIMITS.count;
  let closed = false;
  let position = "0";
  return {
    async step() {
      if (closed) {
        return err({ code: "unavailable", message: "engine이 끝났다" });
      }
      const saved = options.cursor === undefined
        ? position
        : await options.cursor();
      const from = nextFromSeq(saved);
      if (!from.ok) return from;
      const start = BigInt(saved) === 0n ? "0" : from.value;
      const read = await backend.read(machine, {
        position: start,
        inclusive: BigInt(saved) === 0n ? true : false,
        limit: batch,
      });
      if (!read.ok) return read;
      let scanned = read.value.scanned_through_seq;
      for (const event of read.value.events) {
        if (closed) break;
        const through = event.seq;
        const trigger = triggerOf(event.type);
        if (trigger !== undefined) {
          const key = await reactionIdempotencyKey({
            subscriber: NOTIFICATION_SUBSCRIBER,
            cause_seq: through,
            reaction: "create",
          });
          if (!key.ok) return key;
          const created = await command(machine, {
            command: "create_notification",
            input: {
              id: notificationId(BigInt(through)),
              source_seq: through,
              source_event: event.type,
              processed_through_seq: through,
              subscriber: NOTIFICATION_SUBSCRIBER,
            },
            idempotency_key: key.value,
            compare: { processed_through_seq: scanned },
            prepared: [],
          });
          if (!created.ok) return created;
        } else {
          // 계기 없는 구간은 cursor만 전진한다(R2).
          const advanced = await command(machine, {
            command: "AdvanceSubscriberCursor",
            input: {
              subscriber: NOTIFICATION_SUBSCRIBER,
              scanned_through_seq: through,
            },
            idempotency_key: `cursor:${NOTIFICATION_SUBSCRIBER}:${through}`,
            compare: { processed_through_seq: scanned },
            prepared: [],
          });
          if (!advanced.ok) return advanced;
        }
        scanned = through;
      }
      position = scanned;
      return ok(scanned);
    },
    close() {
      closed = true;
    },
  };
}
