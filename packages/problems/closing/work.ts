// `problems.closing` 반응기(problems/closing#R2, R3, R4; architecture/problems 7.6).
// test-runner kind 안에서 돌고 ledger를 직접 열지 않는다. VerificationRecorded·
// ReleaseActivated·ProblemObserved event를 cursor 뒤에서 읽어 후보를 다시 평가하고,
// reproduction pass 근거가 조건을 충족하면 CloseProblemVerified를 낸다. event는 깨우는
// 신호이고 판정 조건은 command가 정본에서 다시 읽는다. 반응 key는
// `(subscriber, cause_seq, reaction)`이고, 처리한 위치는 AdvanceSubscriberCursor로
// 올리므로 재시작은 그 seq 뒤부터 이어 따라잡는다.
import { canonicalize, err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";

export const CLOSING_SUBSCRIBER = "problems.closing";

// 후보를 다시 읽게 하는 event다(R3). reproduction pass만 닫힘 후보이므로 result가
// 나올 때(VerificationRecorded), 활성 release가 바뀔 때(ReleaseActivated), 같은 문제에
// 보고가 더 접수될 때(ProblemObserved) 조건을 다시 본다. release 준비·activation 시작·
// 앱 시작·command 성공·app test·test command·ticket 완료·고친 기록·앱 주장 event는
// 후보로 읽지 않는다(R2).
export const CLOSING_EVENT_TYPES: readonly string[] = [
  "VerificationRecorded",
  "ReleaseActivated",
  "ProblemObserved",
];

export type ClosingEvent = {
  seq: string;
  type: string;
  subject: string | null;
  payload: Record<string, unknown>;
};

export type ClosingReactionPorts = {
  // cursor 뒤(seq > after)의 보이는 event를 읽는다. ListEvents와 같은 모양이다.
  events(after: string, types: readonly string[]): Promise<
    Result<
      {
        events: ClosingEvent[];
        scanned_through_seq: string;
        head_seq: string;
      },
      LophnError
    >
  >;
  // 문제의 현재 기준(seq). 없거나 범위 밖이면 null이다.
  problem(
    problem: string,
  ): Promise<Result<{ seq: string } | null, LophnError>>;
  // 조건 판정은 command가 정본에서 다시 한다. 충족하면 닫고, 아니면 conflict·invalid_input
  // 으로 조건 불충족을 확인한다.
  close(call: {
    key: string;
    input: {
      problem: string;
      verification: string;
      problem_seq: string;
      release: string;
    };
    compare: { problem_seq: string; release: string };
  }): Promise<Result<unknown, LophnError>>;
  advance(through: string, from: string): Promise<Result<unknown, LophnError>>;
};

// 이름 있는 구독자의 안정된 반응 key다(workReactionKey와 같은 모양). 낡은 기준으로
// 다시 읽을 때 같은 key로 다른 compare를 내지 않게 reaction에 읽은 문제 seq를 넣는다.
export async function closingReactionKey(
  cause: string,
  problem: string,
  problemSeq: string,
): Promise<string> {
  return await sha256Hex(
    new TextEncoder().encode(canonicalize({
      subscriber: CLOSING_SUBSCRIBER,
      cause_seq: cause,
      reaction: `close:${problem}:${problemSeq}`,
    })),
  );
}

// 낡은 기준 conflict는 다시 읽어 몇 번 다시 낸다. 그래도 같으면 이 위치에서 멈추고 다음
// 깨움이 잇는다.
const CLOSE_ATTEMPTS = 5;

// event가 가리키는 후보 문제다. VerificationRecorded의 subject는 vrf라 payload에서,
// ReleaseActivated의 subject는 release라 payload가 없어 app으로 좁힐 수 없으니 해당 앱의
// 열린 문제를 전부 후보로 다시 읽는 대신 반응기는 vrf·app 근거를 받아 좁힌다.
function problemsOf(event: ClosingEvent): string[] {
  const listed = event.payload["problem"] ?? event.payload["problems"];
  if (typeof listed === "string") return [listed];
  if (!Array.isArray(listed)) return [];
  return listed.filter((item): item is string => typeof item === "string");
}

async function closeOne(
  ports: ClosingReactionPorts,
  event: ClosingEvent,
  problem: string,
  verification: string,
  release: string,
): Promise<Result<void, LophnError>> {
  for (let attempt = 0; attempt < CLOSE_ATTEMPTS; attempt++) {
    const read = await ports.problem(problem);
    if (!read.ok) return read;
    // 없거나 범위 밖인 문제는 반응할 것이 없다.
    if (read.value === null) return ok(undefined);
    const done = await ports.close({
      key: await closingReactionKey(event.seq, problem, read.value.seq),
      input: {
        problem,
        verification,
        problem_seq: read.value.seq,
        release,
      },
      compare: { problem_seq: read.value.seq, release },
    });
    if (done.ok) return ok(undefined);
    // 조건 불충족이 확정된 것(app test·test_command 결과, 근거 문제 불일치)은 반응하지
    // 않을 사실로 확인하고 넘어간다. 낡은 기준이면 다시 읽는다. 나머지는 멈춘다.
    if (done.error.code === "invalid_input") return ok(undefined);
    if (done.error.code !== "conflict") return done;
  }
  return err({ code: "conflict", message: "문제가 계속 바뀐다" });
}

// cursor부터 head까지 따라잡는다. 반응 command를 확정하거나 조건 불충족을 확인한 뒤에만
// cursor를 올린다. 돌려주는 값은 올린 위치다.
export async function reactClosing(
  ports: ClosingReactionPorts,
  from: string,
): Promise<Result<{ processed_through_seq: string }, LophnError>> {
  let cursor = from;
  for (;;) {
    const before = cursor;
    const listed = await ports.events(cursor, CLOSING_EVENT_TYPES);
    if (!listed.ok) return listed;
    for (const event of listed.value.events) {
      if (!CLOSING_EVENT_TYPES.includes(event.type)) continue;
      const reacted = await reactOne(ports, event);
      if (!reacted.ok) return reacted;
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

// event 하나의 반응이다. VerificationRecorded는 payload의 문제를 좁혀 닫힘 후보로 다시
// 읽는다. ReleaseActivated·ProblemObserved는 event만으로는 좁힐 근거(문제·verification)가
// 없다: 반응기가 문제 표를 읽지 않으므로 이 event들은 cursor만 전진시키고, 다음
// VerificationRecorded가 재평가를 잇는다(R3: 후보는 reproduction pass 근거에서 온다).
async function reactOne(
  ports: ClosingReactionPorts,
  event: ClosingEvent,
): Promise<Result<void, LophnError>> {
  if (event.type !== "VerificationRecorded") return ok(undefined);
  const problem = problemsOf(event)[0];
  const verification = event.subject;
  const target = event.payload["target"];
  const release = typeof target === "object" && target !== null
    ? (target as Record<string, unknown>)["release"]
    : undefined;
  if (
    problem === undefined || verification === null ||
    typeof release !== "string"
  ) {
    return ok(undefined);
  }
  return await closeOne(ports, event, problem, verification, release);
}
