// core의 독립 비동기 루프가 assignments cursor부터 event batch를 읽고, AppCreated
// 계기마다 CreateAppEngineerAssignment을 낸다(R1). AppArchived와 나머지 event는
// 계기가 아니라 cursor만 올린다(R1: 보관이면 멈추고 자동 해제·재개는 하지 않는다).
// 본문 조립·model 호출은 하지 않는다. 전달 실패로 버리지 않고 그 위치에서 멈춘다.
//
// platform은 다른 최상위 package라 직접 부르지 않는다(check-deps). backend와
// 반응 key는 모양만 본다: backend는 event batch 읽기(ListEvents와 같은 값),
// reaction key는 contracts의 reactionKeySchema와 base의 hash가 만든다.

import {
  canonicalize,
  err,
  nextFromSeq,
  ok,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import {
  EVENT_BATCH_LIMITS,
  type EventEnvelope,
  reactionKeySchema,
} from "../../contracts/platform/mod.ts";
import { ASSIGNMENT_SUBSCRIBER } from "../../contracts/lophn-agent/mod.ts";

export type AssignmentEngineCommand = (
  ctx: AuthenticatedContext,
  envelope: {
    command: string;
    input: unknown;
    idempotency_key: string;
    compare: unknown;
    prepared: readonly string[];
  },
) => Promise<Result<unknown>>;

// event batch 읽기 통로다. core의 reader backend와 같은 모양이고(platform/ledger
// EventBackend), 값은 ListEvents의 출력이다.
export type AssignmentEventBackend = {
  read(
    ctx: AuthenticatedContext,
    scan: {
      position: string;
      inclusive: boolean;
      limit?: number;
    },
  ): Promise<
    Result<{
      events: EventEnvelope[];
      scanned_through_seq: string;
      head_seq: string;
    }>
  >;
};

export type AssignmentEngineOptions = {
  // ledger event를 읽는 통로. core의 reader backend다.
  backend: AssignmentEventBackend;
  // CreateAppEngineerAssignment과 AdvanceSubscriberCursor를 낸다. 등록·자격은
  // writer가 본다.
  command: AssignmentEngineCommand;
  machine: AuthenticatedContext;
  // 없으면 cursor 어디서부터인지 몰라 "0"부터 본다.
  cursor?: () => Promise<string>;
  // AppCreated 계기가 만들 assignment가 쓰는 AE preset이다. id, revision은
  // core 기동이 읽어 넣는다(등록된 product preset).
  preset: { preset: string; preset_revision: number };
  // batch 한 페이지의 event 수. 기본은 contract 한도다.
  batch?: number;
};

export type AssignmentEngine = {
  // batch를 하나 읽고 계기마다 command를 낸다. 실패한 위치에서 멈추고 재시작은
  // 같은 cursor부터 다시 읽는다. scanned 위치를 돌려준다.
  step(): Promise<Result<string>>;
  close(): void;
};

// machine ctx는 생성과 cursor 전진 두 operation을 scope에 둔다.
export function assignmentMachineContext(
  base: AuthenticatedContext,
): AuthenticatedContext {
  return {
    ...base,
    scope: {
      ...base.scope,
      operations: [
        ...new Set([
          ...base.scope.operations,
          "CreateAppEngineerAssignment",
          "AdvanceSubscriberCursor",
        ]),
      ],
    },
  };
}

// 반응 key(reactionKeySchema, platform/ledger reactionIdempotencyKey와 같은
// canonicalize + sha256Hex다).
async function reactionKey(
  key: { subscriber: string; cause_seq: string; reaction: string },
): Promise<Result<string>> {
  const parsed = reactionKeySchema.safeParse(key);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "반응 key가 올바르지 않다" });
  }
  return ok(
    await sha256Hex(new TextEncoder().encode(canonicalize(parsed.data))),
  );
}

// source event seq 하나가 AE assignment id 하나가 된다. notification id와 같은
// 고정 폭이다.
function assignmentId(eventSeq: bigint): string {
  return `asg_${eventSeq.toString(10).padStart(26, "0").slice(-26)}`;
}

export function assignmentEngine(
  options: AssignmentEngineOptions,
): AssignmentEngine {
  const { backend, command, machine } = options;
  const preset = options.preset;
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
        // 계기는 AppCreated 하나다. AppArchived는 멈춤만 남기는 state 전이라 여기서
        // 아무것도 내지 않는다(R1: 자동 해제·재개 없음).
        if (event.type === "AppCreated") {
          const key = await reactionKey({
            subscriber: ASSIGNMENT_SUBSCRIBER,
            cause_seq: through,
            reaction: "create",
          });
          if (!key.ok) return key;
          const created = await command(machine, {
            command: "CreateAppEngineerAssignment",
            input: {
              id: assignmentId(BigInt(through)),
              app_created_seq: through,
              app: event.subject ?? "",
              preset: preset.preset,
              preset_revision: preset.preset_revision,
              processed_through_seq: through,
              subscriber: ASSIGNMENT_SUBSCRIBER,
            },
            idempotency_key: key.value,
            compare: { processed_through_seq: scanned },
            prepared: [],
          });
          if (!created.ok) return created;
        } else {
          const advanced = await command(machine, {
            command: "AdvanceSubscriberCursor",
            input: {
              subscriber: ASSIGNMENT_SUBSCRIBER,
              scanned_through_seq: through,
            },
            idempotency_key: `cursor:${ASSIGNMENT_SUBSCRIBER}:${through}`,
            compare: { processed_through_seq: scanned },
            prepared: [],
          });
          if (!advanced.ok) return advanced;
        }
        // cursor는 command마다 하나씩 움직인다. compare는 기록된 cursor다(architecture 5.10).
        scanned = through;
      }
      // 공개 정책이 숨긴 event는 batch에 없다. 그 구간도 읽은 것이므로 cursor를
      // batch가 훑은 끝까지 올린다. 올리지 않으면 숨은 event만 있는 구간에서
      // 같은 batch를 계속 다시 읽는다(R2와 같은 이유다).
      const through = read.value.scanned_through_seq;
      if (!closed && BigInt(through) > BigInt(scanned)) {
        const advanced = await command(machine, {
          command: "AdvanceSubscriberCursor",
          input: {
            subscriber: ASSIGNMENT_SUBSCRIBER,
            scanned_through_seq: through,
          },
          idempotency_key: `cursor:${ASSIGNMENT_SUBSCRIBER}:${through}`,
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
