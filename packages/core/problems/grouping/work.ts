// `problems.work` 반응기. test-runner kind
// 안에서 돌고 ledger를 직접 열지 않는다. ticket event를 cursor 뒤에서 읽어 event가 가리키는
// 문제마다 ReconcileProblemWork를 낸다. event는 깨우는 신호이고 상태는 command가 ticket 정본에서
// 다시 읽는다. 반응 key는 `(subscriber, cause_seq, reaction)`이고, 처리한 위치는
// AdvanceSubscriberCursor로 올리므로 재시작은 그 seq 뒤부터 이어 따라잡는다.
import {
  canonicalize,
  err,
  ok,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  ticketCancelled,
  ticketCheckFailed,
  ticketClaimed,
  ticketClaimReleased,
  ticketCompletionReported,
  ticketConfirmed,
  ticketCreated,
} from "../../../protocol/coding-agent/mod.ts";

export const WORK_SUBSCRIBER = "problems.work";

// 문제의 work·status를 다시 계산하게 하는 ticket event다(TicketCreated 포함).
// TicketCheckFailed도 신호이지만 새 claim으로 보지 않는다: command가 현재 claim 정본으로 계산한다.
export const WORK_EVENT_TYPES: readonly string[] = [
  ticketCreated.type,
  ticketClaimed.type,
  ticketClaimReleased.type,
  ticketCompletionReported.type,
  ticketCancelled.type,
  ticketCheckFailed.type,
  ticketConfirmed.type,
];

export type WorkEvent = {
  seq: string;
  type: string;
  subject: string | null;
  payload: Record<string, unknown>;
};

export type WorkReactionPorts = {
  // cursor 뒤(seq > after)의 보이는 ticket event를 읽는다. ListEvents와 같은 모양이다.
  events(after: string, types: readonly string[]): Promise<
    Result<
      { events: WorkEvent[]; scanned_through_seq: string; head_seq: string }
    >
  >;
  // 문제의 현재 기준(seq·work). 없거나 범위 밖이면 null이다.
  problem(
    problem: string,
  ): Promise<Result<{ seq: string; work: string | null } | null>>;
  reconcile(call: {
    key: string;
    input: { problem: string; ticket: string; ticket_event_seq: string };
    compare: { problem_seq: string; work: string | null };
  }): Promise<Result<unknown>>;
  advance(through: string, from: string): Promise<Result<unknown>>;
};

// 이름 있는 구독자의 안정된 반응 key다(platform/ledger reactionIdempotencyKey와 같은
// canonicalize + sha256Hex). 낡은 기준으로 다시 읽을 때 같은 key로 다른 compare를 내지 않게
// reaction에 읽은 문제 seq를 넣는다.
export async function workReactionKey(
  cause: string,
  problem: string,
  problemSeq: string,
): Promise<string> {
  return await sha256Hex(
    new TextEncoder().encode(canonicalize({
      subscriber: WORK_SUBSCRIBER,
      cause_seq: cause,
      reaction: `reconcile:${problem}:${problemSeq}`,
    })),
  );
}

// 낡은 기준 conflict는 다시 읽어 몇 번 다시 낸다. 그래도 같으면 이 위치에서 멈추고 다음 깨움이 잇는다.
const RECONCILE_ATTEMPTS = 5;

function problemsOf(event: WorkEvent): string[] {
  const listed = event.payload["problems"];
  if (!Array.isArray(listed)) return [];
  return listed.filter((item): item is string => typeof item === "string");
}

async function reconcileOne(
  ports: WorkReactionPorts,
  event: WorkEvent,
  problem: string,
): Promise<Result<void>> {
  const ticket = event.subject;
  if (ticket === null) return ok(undefined);
  for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt++) {
    const read = await ports.problem(problem);
    if (!read.ok) return read;
    // 없거나 범위 밖인 문제는 반응할 것이 없다.
    if (read.value === null) return ok(undefined);
    const done = await ports.reconcile({
      key: await workReactionKey(event.seq, problem, read.value.seq),
      input: { problem, ticket, ticket_event_seq: event.seq },
      compare: { problem_seq: read.value.seq, work: read.value.work },
    });
    if (done.ok) return ok(undefined);
    // 이 ticket이 문제와 맞지 않거나(범위 밖·repair 아님) 열린 ticket이 둘이 되는 연결은 반응하지
    // 않는 사실로 확인하고 넘어간다. 낡은 기준이면 다시 읽는다. 나머지는 멈춘다.
    if (
      done.error.code === "not_found" || done.error.code === "invalid_input"
    ) {
      return ok(undefined);
    }
    if (done.error.code !== "conflict") return done;
  }
  return err({ code: "conflict", message: "문제가 계속 바뀐다" });
}

// cursor부터 head까지 따라잡는다. 반응 command를 확정하거나 조건 불충족을 확인한 뒤에만
// cursor를 올린다. 돌려주는 값은 올린 위치다.
export async function reactWork(
  ports: WorkReactionPorts,
  from: string,
): Promise<Result<{ processed_through_seq: string }>> {
  let cursor = from;
  for (;;) {
    const before = cursor;
    const listed = await ports.events(cursor, WORK_EVENT_TYPES);
    if (!listed.ok) return listed;
    for (const event of listed.value.events) {
      if (!WORK_EVENT_TYPES.includes(event.type)) continue;
      // 구현 ticket에는 문제가 없다. TicketCreated의 kind가 repair가 아니면 건너뛴다.
      if (event.type === ticketCreated.type) {
        if (event.payload["kind"] !== "repair") {
          const skipped = await ports.advance(event.seq, cursor);
          if (!skipped.ok) return skipped;
          cursor = event.seq;
          continue;
        }
      }
      for (const problem of problemsOf(event)) {
        const reacted = await reconcileOne(ports, event, problem);
        if (!reacted.ok) return reacted;
      }
      const advanced = await ports.advance(event.seq, cursor);
      if (!advanced.ok) return advanced;
      cursor = event.seq;
    }
    const scanned = listed.value.scanned_through_seq;
    if (BigInt(scanned) > BigInt(cursor)) {
      const advanced = await ports.advance(scanned, cursor);
      if (!advanced.ok) return advanced;
      cursor = scanned;
    }
    // head에 닿았거나 읽을 것이 더 나아가지 않으면 따라잡은 것이다.
    if (BigInt(cursor) >= BigInt(listed.value.head_seq) || cursor === before) {
      return ok({ processed_through_seq: cursor });
    }
  }
}
