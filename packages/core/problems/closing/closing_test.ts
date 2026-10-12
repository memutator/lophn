// 테스트로 확인됨 닫힘의 단위 규칙(problems/closing#R3, R5, R14)과 `problems.closing`
// 반응기(problems/closing#R2, R4). 판정 조건은 command가 정본에서 다시 읽는다.
// framing: verified 근거는 reproduction pass뿐, CAS 재료는 문제 seq·활성 release 둘이다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import type { Verification } from "../../../protocol/problems/mod.ts";
import { verifiedCandidate, verifiedClosure } from "./model.ts";
import {
  CLOSING_EVENT_TYPES,
  type ClosingEvent,
  closingReactionKey,
  type ClosingReactionPorts,
  reactClosing,
} from "./work.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REL_BEFORE = "rel_01arz3ndektsv4rrffq69g5fa1";
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5fa2";
const PROBLEM = "prb_01arz3ndektsv4rrffq69g5fa1";

const HASH = "a".repeat(64);

function verification(
  patch: Partial<Verification> = {},
): Verification {
  return {
    id: "vrf_01arz3ndektsv4rrffq69g5fav",
    request_key: "key-1",
    request_principal: "runner-1",
    request_hash: HASH,
    kind: "reproduction",
    app: APP,
    target: { bundle_hash: HASH, release: REL_AFTER },
    problem: PROBLEM,
    basis_seq: "9",
    reports: ["rpt_01arz3ndektsv4rrffq69g5fa1"],
    before: REL_BEFORE,
    after: REL_AFTER,
    ticket: null,
    test: HASH,
    execution: HASH,
    result: "pass",
    reason: "before reproduced and after met",
    observations: HASH,
    ...patch,
  };
}

Deno.test("problems/closing#R3: only a reproduction pass is a verified candidate", () => {
  const pass = verifiedCandidate(verification());
  assert(pass.ok);
  assert(pass.value !== null);
  assertEquals(verifiedClosure(pass.value).reason, "verified");
  assertEquals(verifiedClosure(pass.value).verification, verification().id);
  assertEquals(verifiedClosure(pass.value).release, REL_AFTER);

  // app test·test command 결과와 실패·불가 판정은 후보가 아니다.
  const others = [
    verification({ kind: "app_test" }),
    verification({ kind: "test_command" }),
    verification({ result: "fail" }),
    verification({ result: "inconclusive" }),
  ];
  for (const other of others) {
    const none = verifiedCandidate(other);
    assert(none.ok, JSON.stringify(none));
    assertEquals(none.value, null);
  }

  // 근거 연결(problem·basis_seq·after)이 없는 reproduction pass도 후보가 아니다.
  const loose = verifiedCandidate(verification({ problem: null }));
  assert(!loose.ok);
  assertEquals(loose.error.code, "invalid_input");
  const unbasis = verifiedCandidate(verification({ basis_seq: null }));
  assert(!unbasis.ok);
});

Deno.test("problems/closing#R14: the closure is bound to the verification basis and the release", () => {
  // verified closure는 근거 그대로다: release는 after, verification는 근거 ID다.
  const closure = verifiedClosure({
    verification: verification(),
  });
  assertEquals(closure, {
    reason: "verified",
    basis_seq: "9",
    release: REL_AFTER,
    verification: "vrf_01arz3ndektsv4rrffq69g5fav",
    confirmation: null,
    last_report: null,
    note: null,
  });
});

// 반응기: 메모리 ledger 대역이다. event 목록·문제 기준·cursor를 갖고 ports를 낸다.
type Fake = {
  ports: ClosingReactionPorts;
  cursor: () => string;
  calls: {
    key: string;
    problem: string;
    verification: string;
    problem_seq: string;
    release: string;
  }[];
  failOn?: (call: { problem: string; verification: string }) => boolean;
};

function fake(
  events: ClosingEvent[],
  options: {
    problem?: (problem: string) => { seq: string } | null;
    close?: (n: number) => Result<unknown, LophnError>;
  } = {},
): Fake {
  let cursor = "0";
  const calls: Fake["calls"] = [];
  const head = events.at(-1)?.seq ?? "0";
  const self: Fake = {
    calls,
    cursor: () => cursor,
    ports: {
      events(after, types) {
        const seen = events.filter((event) =>
          BigInt(event.seq) > BigInt(after) && types.includes(event.type)
        );
        return Promise.resolve(
          ok({ events: seen, scanned_through_seq: head, head_seq: head }),
        );
      },
      problem(problem) {
        return Promise.resolve(
          ok(
            options.problem ? options.problem(problem) : { seq: "10" },
          ),
        );
      },
      close(call) {
        calls.push({
          key: call.key,
          problem: call.input.problem,
          verification: call.input.verification,
          problem_seq: call.input.problem_seq,
          release: call.input.release,
        });
        return Promise.resolve(
          options.close ? options.close(calls.length) : ok({}),
        );
      },
      advance(through, from) {
        if (from !== cursor) {
          return Promise.resolve(
            err({ code: "conflict", message: "cursor가 다르다" }),
          );
        }
        cursor = through;
        return Promise.resolve(ok({}));
      },
    },
  };
  return self;
}

const event = (
  seq: string,
  type: string,
  subject: string | null,
  payload: Record<string, unknown>,
): ClosingEvent => ({ seq, type, subject, payload });

Deno.test("problems/closing#R3: the reaction reads only VerificationRecorded, ReleaseActivated and ProblemObserved as candidates", async () => {
  const events = [
    event("3", "VerificationRecorded", "vrf_01arz3ndektsv4rrffq69g5fav", {
      kind: "reproduction",
      app: APP,
      problem: PROBLEM,
      basis_seq: "9",
      target: { bundle_hash: HASH, release: REL_AFTER },
      result: "pass",
      test: HASH,
      execution: HASH,
    }),
    // 반응기가 보지 않는 type은 건너뛴다(R2: release 준비·activation 시작·ticket 완료·
    // 고친 기록 등만으로는 닫히지 않는다).
    event("4", "ReleasePrepared", REL_AFTER, { app: APP }),
    event("5", "AppStarted", APP, {}),
    event("6", "ProblemFixRecorded", PROBLEM, {}),
    event("7", "TicketCompletionReported", "tkt_01arz3ndektsv4rrffq69g5fav", {
      problems: [PROBLEM],
    }),
  ];
  const world = fake(events);
  const done = await reactClosing(world.ports, "0");
  assert(done.ok, done.ok ? undefined : done.error.message);
  assertEquals(done.value.processed_through_seq, "7");
  // VerificationRecorded 하나만 문제를 좁혀 닫힘 후보로 다시 읽는다.
  assertEquals(world.calls.length, 1);
  assertEquals(world.calls[0]!.problem, PROBLEM);
  assertEquals(world.calls[0]!.verification, "vrf_01arz3ndektsv4rrffq69g5fav");
  assertEquals(world.calls[0]!.release, REL_AFTER);
  assertEquals(world.calls[0]!.problem_seq, "10");
  assert(CLOSING_EVENT_TYPES.includes("ReleaseActivated"));
  assert(CLOSING_EVENT_TYPES.includes("ProblemObserved"));
});

Deno.test("problems/closing#R4: an app_test or test_command pass is not re-read as a closing candidate", async () => {
  // VerificationRecorded payload가 app_test면 문제를 좁히지 않는다: 후보는 reproduction뿐이다.
  const events = [
    event("3", "VerificationRecorded", "vrf_01arz3ndektsv4rrffq69g5fa1", {
      kind: "app_test",
      app: APP,
      target: { bundle_hash: HASH, release: null },
      result: "pass",
      test: HASH,
      execution: HASH,
    }),
    event("4", "VerificationRecorded", "vrf_01arz3ndektsv4rrffq69g5fa2", {
      kind: "test_command",
      app: APP,
      target: { bundle_hash: HASH, release: null },
      result: "pass",
      test: HASH,
      execution: HASH,
    }),
  ];
  const world = fake(events);
  const done = await reactClosing(world.ports, "0");
  assert(done.ok, done.ok ? undefined : done.error.message);
  assertEquals(done.value.processed_through_seq, "4");
  assertEquals(world.calls, []);
});

Deno.test("problems/closing#R5: the reaction key is (subscriber, cause_seq, reaction) and a stale read is read again without repeating the key", async () => {
  const events = [
    event("3", "VerificationRecorded", "vrf_01arz3ndektsv4rrffq69g5fav", {
      kind: "reproduction",
      app: APP,
      problem: PROBLEM,
      basis_seq: "9",
      target: { bundle_hash: HASH, release: REL_AFTER },
      result: "pass",
      test: HASH,
      execution: HASH,
    }),
  ];
  let reads = 0;
  const conflicted = fake(events, {
    problem: () => ({ seq: String(10 + reads++) }),
    close: (
      n,
    ) => (n === 1
      ? err({ code: "conflict", message: "문제가 바뀌었다" })
      : ok({})),
  });
  const done = await reactClosing(conflicted.ports, "0");
  assert(done.ok, done.ok ? undefined : done.error.message);
  // 첫 반응은 낡은 기준이라 다시 읽고 다른 key로 다시 냈다.
  assertEquals(conflicted.calls.map((call) => call.problem_seq), ["10", "11"]);
  assert(conflicted.calls[0]!.key !== conflicted.calls[1]!.key);
  assertEquals(conflicted.cursor(), "3");
  assertEquals(
    await closingReactionKey("3", PROBLEM, "10"),
    conflicted.calls[0]!.key,
  );
  // 같은 cause라도 읽은 문제 seq가 다르면 key가 다르다(같은 key로 다른 compare를 내지 않는다
  // — R14의 낡은 판정 덮어쓰기 방지).
  const sameCauseOtherSeq = await closingReactionKey("3", PROBLEM, "11");
  assertFalse(sameCauseOtherSeq === conflicted.calls[0]!.key);
});

Deno.test("problems/closing#R14: a permanently stale problem stops at its position and the next wake continues", async () => {
  const events = [
    event("3", "VerificationRecorded", "vrf_01arz3ndektsv4rrffq69g5fav", {
      kind: "reproduction",
      app: APP,
      problem: PROBLEM,
      basis_seq: "9",
      target: { bundle_hash: HASH, release: REL_AFTER },
      result: "pass",
      test: HASH,
      execution: HASH,
    }),
    event("6", "ReleaseActivated", REL_AFTER, {}),
  ];
  const stuck = fake(events, {
    close: () => err({ code: "conflict", message: "문제가 계속 바뀐다" }),
  });
  const done = await reactClosing(stuck.ports, "0");
  assertFalse(done.ok);
  assertEquals(done.error.code, "conflict");
  // 위치를 올리지 않고 멈춘다: 재시작 뒤 같은 event부터 다시 본다.
  assertEquals(stuck.cursor(), "0");

  // 없는 문제는 반응할 것이 없다.
  const noProblem = fake(events, { problem: () => null });
  const done2 = await reactClosing(noProblem.ports, "0");
  assert(done2.ok, done2.ok ? undefined : done2.error.message);
  assertEquals(noProblem.calls, []);
  assertEquals(done2.value.processed_through_seq, "6");

  // 조건 불충족(invalid_input)은 확정된 사실로 확인하고 cursor를 올린다.
  const unfit = fake(events, {
    close: () =>
      err({ code: "invalid_input", message: "reproduction pass만 닫는다" }),
  });
  const done3 = await reactClosing(unfit.ports, "0");
  assert(done3.ok, done3.ok ? undefined : done3.error.message);
  assertEquals(unfit.calls.length, 1);
  assertEquals(done3.value.processed_through_seq, "6");
});

Deno.test("problems/closing#R2: an unavailable core stops the reaction without acknowledging events", async () => {
  const events = [
    event("3", "VerificationRecorded", "vrf_01arz3ndektsv4rrffq69g5fav", {
      kind: "reproduction",
      app: APP,
      problem: PROBLEM,
      basis_seq: "9",
      target: { bundle_hash: HASH, release: REL_AFTER },
      result: "pass",
      test: HASH,
      execution: HASH,
    }),
  ];
  const down = fake(events, {
    close: () => err({ code: "unavailable", message: "core가 불가하다" }),
  });
  const done = await reactClosing(down.ports, "0");
  assertFalse(done.ok);
  assertEquals(done.error.code, "unavailable");
  assertEquals(down.cursor(), "0");
});
