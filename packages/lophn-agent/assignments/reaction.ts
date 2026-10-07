// core의 독립 비동기 루프가 assignments cursor부터 event batch를 읽고, AppCreated
// 계기마다 CreateAppEngineerAssignment을, AppArchived 계기마다 그 앱의 enabled AE
// assignment 멈춤(PauseAssignment, scope_archived)을 낸다(R1). 반응과 cursor 전진은
// 같은 transaction이다. AppUnarchived와 나머지 event는 cursor만 올린다(자동 해제·재개는
// 없다. 재개는 사람의 ResumeAssignment뿐이다). 본문 조립·model 호출은 하지 않는다. 전달
// 실패로 버리지 않고 그 위치에서 멈춘다.
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
  // AppCreated 계기가 만들 assignment가 쓰는 AE preset이다. core가 등록된 product preset을
  // ledger read로 읽어 준다. 아직 없으면 null이고 그 AppCreated에서 멈춘 채 다시 읽는다.
  preset: () => Promise<
    Result<{ preset: string; preset_revision: number } | null>
  >;
  // 앱의 거두지 않은 AE assignment다(없으면 null). AppArchived 반응이 멈출 대상을 본다.
  findAppEngineer: (
    app: string,
  ) => Promise<
    Result<{ id: string; revision: number; state: string } | null>
  >;
  // batch 한 페이지의 event 수. 기본은 contract 한도다.
  batch?: number;
};

export type AssignmentEngine = {
  // batch를 하나 읽고 계기마다 command를 낸다. 실패한 위치에서 멈추고 재시작은
  // 같은 cursor부터 다시 읽는다. scanned 위치를 돌려준다.
  step(): Promise<Result<string>>;
  close(): void;
};

// machine ctx가 scope에 두는 operation이다. 읽기(ListEvents, ListAssignments, ListPresets)와
// 반응(생성·멈춤)과 cursor 전진뿐이다.
export const ASSIGNMENT_REACTION_OPERATIONS = [
  "ListEvents",
  "ListAssignments",
  "ListPresets",
  "CreateAppEngineerAssignment",
  "PauseAssignment",
  "AdvanceSubscriberCursor",
] as const;

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
  const batch = options.batch ?? EVENT_BATCH_LIMITS.count;
  let closed = false;
  let position = "0";
  // 계기가 아닌 구간은 cursor만 올린다.
  const advance = (through: string, scanned: string) =>
    command(machine, {
      command: "AdvanceSubscriberCursor",
      input: {
        subscriber: ASSIGNMENT_SUBSCRIBER,
        scanned_through_seq: through,
      },
      idempotency_key: `cursor:${ASSIGNMENT_SUBSCRIBER}:${through}`,
      compare: { processed_through_seq: scanned },
      prepared: [],
    });
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
        // 계기는 AppCreated(생성)와 AppArchived(멈춤)다. AppUnarchived는 계기가 아니다:
        // 멈춘 책임은 사람이 다시 켠다(R1).
        if (event.type === "AppCreated") {
          const preset = await options.preset();
          if (!preset.ok) return preset;
          // AE preset이 아직 없다. 이 event에서 멈추고(cursor를 올리지 않는다) 다시 읽는다.
          if (preset.value === null) {
            return err({
              code: "unavailable",
              message: "App Engineer preset이 아직 없다",
            });
          }
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
              preset: preset.value.preset,
              preset_revision: preset.value.preset_revision,
              processed_through_seq: through,
              subscriber: ASSIGNMENT_SUBSCRIBER,
            },
            idempotency_key: key.value,
            compare: { processed_through_seq: scanned },
            prepared: [],
          });
          if (!created.ok) return created;
        } else if (event.type === "AppArchived") {
          const found = await options.findAppEngineer(event.subject ?? "");
          if (!found.ok) return found;
          if (found.value !== null && found.value.state === "enabled") {
            const key = await reactionKey({
              subscriber: ASSIGNMENT_SUBSCRIBER,
              cause_seq: through,
              reaction: "pause",
            });
            if (!key.ok) return key;
            const paused = await command(machine, {
              command: "PauseAssignment",
              input: {
                assignment: found.value.id,
                reason: {
                  kind: "scope_archived",
                  detail: "The app was archived.",
                  runs: [],
                  target: event.subject ?? "",
                },
                processed_through_seq: through,
                subscriber: ASSIGNMENT_SUBSCRIBER,
              },
              idempotency_key: key.value,
              compare: {
                revision: found.value.revision,
                state: "enabled",
                processed_through_seq: scanned,
              },
              prepared: [],
            });
            if (!paused.ok) return paused;
          } else {
            // 이미 멈췄거나 거둔 책임이다. 다시 멈추지 않고 cursor만 올린다.
            const advanced = await advance(through, scanned);
            if (!advanced.ok) return advanced;
          }
        } else {
          const advanced = await advance(through, scanned);
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
        const advanced = await advance(through, scanned);
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
