import { assert, assertEquals } from "@std/assert";
import {
  type Candidate,
  createRunSelector,
  pickCandidate,
  type RecentStart,
  startableCandidates,
  tierOf,
  YIELD_AFTER,
} from "./work.ts";
import {
  acceptRun,
  ASG_CE,
  ASG_LOPHN,
  envelope,
  finishRunFixture,
  ledgerRead,
  must,
  readRunRecord,
  runId,
  seedAssignments,
  startRunFixture,
  userCredential,
} from "./testing/runs.ts";
import { openRunLedger } from "./testing/open_test.ts";

// run selector 테스트(lophn-agent/harness/run-loop#R4). 순수 선택은 합성 후보로,
// 시작 목록 재구성·막힌 assignment·선행 정책은 실제 임시 ledger와 RunStarted
// event로 확인한다. model provider는 부르지 않는다.

function cand(
  run: number,
  assignment: number,
  tier: 1 | 2 | 3,
  seq: number,
): Candidate {
  return {
    run: runId("run", run),
    assignment: runId("asg", assignment),
    tier,
    acceptedSeq: BigInt(seq),
    stateSeq: String(seq),
  };
}

function starts(...entries: [seq: number, tier: 1 | 2 | 3][]): RecentStart[] {
  return entries.map(([seq, tier]) => ({ seq: BigInt(seq), tier }));
}

const upper = (from: number, count: number): RecentStart[] =>
  starts(...Array.from({ length: count }, (_, i): [number, 1 | 2 | 3] => [
    from + i,
    1,
  ]));

Deno.test("lophn-agent/harness/run-loop#R4: 사람이 기다리는 일·한 번짜리 일·주기 일 세 우선순위로 고르고 각 칸은 접수 순서 FIFO다", () => {
  // 접수가 늦어도 상위 칸이 먼저다.
  const picked = pickCandidate(
    [cand(1, 1, 3, 10), cand(2, 2, 2, 11), cand(3, 3, 1, 12)],
    [],
  );
  assertEquals(picked?.run, runId("run", 3));
  assertEquals(picked?.reason, "priority");
  // 같은 칸은 가장 오래 접수한 것부터다.
  assertEquals(
    pickCandidate([cand(1, 1, 1, 30), cand(2, 2, 1, 20), cand(3, 3, 1, 25)], [])
      ?.run,
    runId("run", 2),
  );
  // 상위가 없으면 다음 칸이고, 후보가 없으면 없다.
  assertEquals(
    pickCandidate([cand(1, 1, 3, 10), cand(2, 2, 2, 11)], [])?.run,
    runId("run", 2),
  );
  assertEquals(
    pickCandidate([cand(1, 1, 3, 10), cand(2, 2, 3, 9)], [])?.run,
    runId("run", 2),
  );
  assertEquals(pickCandidate([], []), undefined);
  // 선택은 이름 있는 값을 읽기만 한다. 같은 입력은 같은 답이다.
  const input = [cand(1, 1, 2, 5), cand(2, 2, 1, 6)];
  assertEquals(pickCandidate(input, []), pickCandidate(input, []));
  assertEquals(YIELD_AFTER, 8);
});

Deno.test("lophn-agent/harness/run-loop#R4: 상위 일 8개를 연속으로 시작한 뒤에는 가장 오래 기다린 하위 후보가 다음 자리를 받는다", () => {
  const waiting = [cand(1, 1, 1, 100), cand(2, 2, 3, 50)];
  // 접수(seq 50) 뒤 상위 시작이 7개면 아직 상위 차례다.
  assertEquals(pickCandidate(waiting, upper(60, 7))?.reason, "priority");
  assertEquals(pickCandidate(waiting, upper(60, 7))?.run, runId("run", 1));
  // 8개 연속이면 하위 차례다.
  const yielded = pickCandidate(waiting, upper(60, 8));
  assertEquals(yielded?.run, runId("run", 2));
  assertEquals(yielded?.reason, "yield");
  // 하위를 시작하면 연속이 끊겨 다시 상위 차례다.
  assertEquals(
    pickCandidate(waiting, [...upper(60, 8), ...starts([70, 3])])?.reason,
    "priority",
  );
  // 하위가 끼어 있던 7개 앞의 시작은 연속에 들지 않는다.
  assertEquals(
    pickCandidate(waiting, [
      ...upper(60, 5),
      ...starts([66, 3]),
      ...upper(67, 7),
    ])
      ?.reason,
    "priority",
  );
  // 하위 후보가 접수되기 전의 시작은 기다린 시간이 아니다.
  assertEquals(
    pickCandidate(
      [cand(1, 1, 1, 100), cand(2, 2, 3, 99)],
      upper(10, 12),
    )?.reason,
    "priority",
  );
  // 여러 하위 칸이 기다렸으면 가장 오래 접수한 쪽이다.
  const both = pickCandidate(
    [cand(1, 1, 1, 100), cand(2, 2, 3, 40), cand(3, 3, 2, 45)],
    upper(60, 8),
  );
  assertEquals(both?.run, runId("run", 2));
  // 한 칸 아래만 기다린 후보는 그 칸 위의 시작만 센다. 같은 칸 시작은 연속이 아니다.
  assertEquals(
    pickCandidate(
      [cand(1, 1, 1, 100), cand(2, 2, 2, 40)],
      starts(...Array.from({ length: 8 }, (_, i): [number, 1 | 2 | 3] => [
        60 + i,
        i === 4 ? 2 : 1,
      ])),
    )?.reason,
    "priority",
  );
  // 상위 후보가 없으면 양보가 아니라 그냥 그 후보다.
  assertEquals(
    pickCandidate([cand(2, 2, 3, 50)], upper(60, 20))?.reason,
    "priority",
  );
});

Deno.test("lophn-agent/harness/run-loop#R4: 막힌 assignment의 후보는 양보를 받지도 쓰지도 않는다", () => {
  const accepted = (
    run: number,
    assignment: number,
    seq: number,
    extra: Record<string, unknown> = {},
  ) =>
    ({
      id: runId("run", run),
      assignment: runId("asg", assignment),
      session: null,
      source: { kind: "schedule", assignment_revision: 1, scheduled_at: "x" },
      continued_from: null,
      start_after: null,
      start_confirmed_seq: null,
      state: "accepted",
      accepted_seq: String(seq),
      state_seq: String(seq),
      ...extra,
    }) as never;
  const enabled = new Set([runId("asg", 1), runId("asg", 2), runId("asg", 3)]);
  // assignment 2는 진행 중 run이 있어 막혔다. 하위(주기) 후보가 있어도 후보가 아니다.
  const blockedLower = startableCandidates({
    accepted: [
      accepted(1, 1, 100, { source: { kind: "message", message: "m" } }),
      accepted(2, 2, 50),
    ],
    enabled,
    live: new Set([runId("asg", 2)]),
    predecessor: () => undefined,
  });
  assertEquals(blockedLower.map((item) => item.run), [runId("run", 1)]);
  // 상위 시작이 8개 지나도 막힌 하위는 자리를 받지 않고 무관한 후보를 막지도 않는다.
  assertEquals(
    pickCandidate(blockedLower, upper(60, 20))?.run,
    runId("run", 1),
  );
  // 막힘이 풀리면 이미 기다린 만큼으로 바로 자리를 받는다(자리를 쓴 적이 없다).
  const freed = startableCandidates({
    accepted: [
      accepted(1, 1, 100, { source: { kind: "message", message: "m" } }),
      accepted(2, 2, 50),
    ],
    enabled,
    live: new Set(),
    predecessor: () => undefined,
  });
  assertEquals(pickCandidate(freed, upper(60, 8))?.run, runId("run", 2));
  // 멈춘·회수한 assignment, 선행이 허락하지 않은 run도 후보가 아니다. 같은 assignment는 맨 앞 하나다.
  const gated = startableCandidates({
    accepted: [
      accepted(3, 1, 10, { start_after: runId("run", 9) }),
      accepted(4, 1, 11, { source: { kind: "message", message: "m" } }),
      accepted(5, 1, 12, { source: { kind: "message", message: "n" } }),
      accepted(6, 3, 13),
    ],
    enabled: new Set([runId("asg", 1)]),
    live: new Set(),
    predecessor: (id) =>
      id === runId("run", 9)
        ? {
          state: "finished",
          outcome: { kind: "failed", reason: "model_error" },
        }
        : undefined,
  });
  assertEquals(gated.map((item) => item.run), [runId("run", 4)]);
  assertEquals(
    tierOf({ source: { kind: "schedule" } as never, continued_from: null }),
    3,
  );
  assertEquals(
    tierOf({ source: { kind: "message" } as never, continued_from: "run_x" }),
    2,
  );
});

const MSG = (n: number) => ({ kind: "message", message: runId("msg", n) });

async function cycle(
  h: Awaited<ReturnType<typeof openRunLedger>>,
  run: number,
  message: number,
  assignment: string,
) {
  must(
    await acceptRun(h, {
      run: runId("run", run),
      source: MSG(message),
      assignment,
    }),
  );
  return runId("run", run);
}

Deno.test("lophn-agent/harness/run-loop#R4: 실제 ledger의 RunStarted만으로 연속 시작을 다시 만들어 8개 뒤 하위 후보에 자리를 준다", async () => {
  const h = await openRunLedger();
  try {
    await seedAssignments(h);
    const read = ledgerRead(h);
    // 아무것도 접수하지 않았으면 고를 것이 없다.
    assertEquals(must(await createRunSelector({ read }).next()), null);

    // lophn의 사람 요청 하나가 먼저 있고, 그 요청에서 CE로 handoff를 보냈다(한 번짜리 칸).
    const first = await cycle(h, 1, 1, ASG_LOPHN);
    const handoff = runId("run", 100);
    must(
      await acceptRun(h, {
        run: handoff,
        assignment: ASG_CE,
        source: {
          kind: "handoff",
          sender_run: first,
          original_message: runId("msg", 1),
          body: "d".repeat(64),
          references: [],
          dedup_key: "handoff-1",
        },
      }),
    );
    const selector = createRunSelector({ read });
    // 8번의 상위 시작. 매번 사람 요청이 먼저고 CE handoff는 기다린다.
    for (let n = 1; n <= 8; n++) {
      const run = n === 1 ? first : await cycle(h, n, n, ASG_LOPHN);
      const picked = must(await selector.next());
      assertEquals(picked?.run, run, `start ${n}`);
      assertEquals(picked?.reason, "priority");
      assertEquals(picked?.assignment, ASG_LOPHN);
      must(await startRunFixture(h, run, ASG_LOPHN));
      must(
        await finishRunFixture(h, run, {
          kind: "completed",
          reason: "answer_completed",
        }),
      );
    }
    // 9번째 사람 요청이 있어도 8개 연속 뒤라서 가장 오래 기다린 handoff가 자리를 받는다.
    const ninth = await cycle(h, 9, 9, ASG_LOPHN);
    const yielded = must(await selector.next());
    assertEquals(yielded?.run, handoff);
    assertEquals(yielded?.reason, "yield");
    assertEquals(yielded?.assignment, ASG_CE);
    // 같은 연속은 프로세스를 다시 띄운 selector도 같은 답이다(event에서 재구성).
    const restarted = must(await createRunSelector({ read }).next());
    assertEquals(restarted, yielded);
    // 시작하면 연속이 끊겨 사람 요청이 다시 먼저다.
    assert(yielded !== null);
    must(await startRunFixture(h, handoff, ASG_CE));
    must(
      await finishRunFixture(h, handoff, {
        kind: "completed",
        reason: "answer_completed",
      }),
    );
    const after = must(await selector.next());
    assertEquals(after?.run, ninth);
    assertEquals(after?.reason, "priority");
    // 한 번 더 읽어도 ledger를 바꾸지 않는다.
    assertEquals(must(await selector.next()), after);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R4: 진행 중·멈춘 assignment와 선행 정책에 막힌 run은 무관한 후보를 막지 않는다", async () => {
  const h = await openRunLedger();
  try {
    await seedAssignments(h);
    const selector = createRunSelector({ read: ledgerRead(h) });
    // lophn에 진행 중 run이 있고 다음 요청이 막혀 있다. CE의 handoff가 먼저 시작된다.
    const live = await cycle(h, 1, 1, ASG_LOPHN);
    must(await startRunFixture(h, live, ASG_LOPHN));
    const blocked = await cycle(h, 2, 2, ASG_LOPHN);
    must(
      await acceptRun(h, {
        run: runId("run", 3),
        assignment: ASG_CE,
        source: {
          kind: "handoff",
          sender_run: live,
          original_message: runId("msg", 1),
          body: "d".repeat(64),
          references: [],
          dedup_key: "handoff-2",
        },
      }),
    );
    const picked = must(await selector.next());
    assertEquals(picked?.run, runId("run", 3));
    assertEquals(picked?.reason, "priority");
    // CE를 멈추면 후보는 없다. 막힌 lophn 요청도 시작 가능하지 않다.
    must(
      await h.command(
        userCredential,
        envelope("PauseAssignment", {
          assignment: ASG_CE,
          reason: { kind: "user", detail: "잠시", runs: [], target: null },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    assertEquals(must(await selector.next()), null);
    // lophn의 진행 run이 실패하면 다음 요청은 사람이 확인하기 전 후보가 아니다.
    must(
      await finishRunFixture(h, live, {
        kind: "failed",
        reason: "model_error",
      }),
    );
    const next = runId("run", 4);
    must(
      await acceptRun(h, {
        run: next,
        source: MSG(4),
        start_after: live,
      }),
    );
    // 선행 없이 접수한 run(blocked)은 선행 정책과 무관하게 시작할 수 있다.
    assertEquals(must(await selector.next())?.run, blocked);
    must(await startRunFixture(h, blocked, ASG_LOPHN));
    must(
      await finishRunFixture(h, blocked, {
        kind: "completed",
        reason: "answer_completed",
      }),
    );
    // 실패한 선행 뒤의 run은 보존만 되고 후보가 아니다.
    assertEquals(must(await selector.next()), null);
    // 사람이 계속하기로 확인하면 후보가 된다.
    const record = await readRunRecord(h, next);
    const predecessor = await readRunRecord(h, live);
    must(
      await h.command(
        userCredential,
        envelope("ConfirmNextRun", { run: next, predecessor: live }, {
          accepted_seq: record.accepted_seq,
          predecessor_state_seq: predecessor.state_seq,
        }),
      ),
    );
    assertEquals(must(await selector.next())?.run, next);
  } finally {
    await h.close();
  }
});
