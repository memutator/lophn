// core의 독립 비동기 루프가 notifications cursor부터 event batch를 읽고, 계기가
// 있으면 create_notification을, 없으면 cursor만 올린다(R1, R2). 본문 조립·OS 표시·
// model 호출은 하지 않는다(R8). 전달 실패로 버리지 않고 그 위치에서 멈춘다.

import { err, nextFromSeq, ok, type Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/platform/mod.ts";
import { EVENT_BATCH_LIMITS } from "../../protocol/platform/mod.ts";
import { reactionIdempotencyKey } from "../storage/ledger/mod.ts";
import type { EventBackend } from "../storage/ledger/mod.ts";
import { NOTIFICATION_SUBSCRIBER } from "./commands.ts";
import { conditionMet, triggerOf } from "./model.ts";

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
      // cursor 뒤(seq > saved)부터 읽는다. 처음(0)도 같다.
      const read = await backend.read(machine, {
        position: saved,
        inclusive: false,
        limit: batch,
      });
      if (!read.ok) return read;
      let scanned = saved;
      for (const event of read.value.events) {
        if (closed) break;
        const through = event.seq;
        const trigger = triggerOf(event.type);
        // 계기 표의 event여도 조건이 아니면(사람이 직접 멈춘 assignment 등) 계기가 아니다.
        // create_notification은 조건 밖 source를 거절하므로, 여기서 먼저 걸러 cursor만 올린다.
        // 거르지 않으면 그 event에서 같은 거절을 되풀이하며 뒤의 계기를 영영 못 만든다(R2).
        if (trigger !== undefined && conditionMet(trigger, event.payload)) {
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
        // cursor는 command마다 하나씩 움직인다. compare는 기록된 cursor다(architecture 5.10).
        scanned = through;
      }
      // 공개 정책이 숨긴 event는 batch에 없다. 그 구간도 읽은 것이므로 cursor를 batch가 훑은
      // 끝까지 올린다. 올리지 않으면 숨은 event만 있는 구간에서 같은 batch를 계속 다시 읽는다(R2).
      const through = read.value.scanned_through_seq;
      if (!closed && BigInt(through) > BigInt(scanned)) {
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
