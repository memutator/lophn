import { assert, assertEquals } from "@std/assert";
import {
  type Candidate,
  createRunSelector,
  pickCandidate,
  queueKeyOf,
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
  pauseAssignmentFixture,
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
  tier: 1 | 2,
  seq: number,
  session: number | null = null,
): Candidate {
  return {
    run: runId("run", run),
    assignment: runId("asg", assignment),
    session: session === null ? null : runId("ses", session),
    tier,
    acceptedSeq: BigInt(seq),
    stateSeq: String(seq),
  };
}

function starts(...entries: [seq: number, tier: 1 | 2][]): RecentStart[] {
  return entries.map(([seq, tier]) => ({ seq: BigInt(seq), tier }));
}

const upper = (from: number, count: number): RecentStart[] =>
  starts(...Array.from({ length: count }, (_, i): [number, 1 | 2] => [
    from + i,
    1,
  ]));

Deno.test("lophn-agent/harness/run-loop#R4 [agent-I40]: 사람이 기다리는 일·사람의 한 번짜리 일 두 우선순위로 고르고 각 칸은 접수 순서 FIFO다", () => {
  // 접수가 늦어도 상위 칸이 먼저다.
  const picked = pickCandidate([cand(1, 1, 2, 10), cand(2, 2, 1, 12)], []);
  assertEquals(picked?.run, runId("run", 2));
  assertEquals(picked?.reason, "priority");
  // 같은 칸은 가장 오래 접수한 것부터다.
  assertEquals(
    pickCandidate([cand(1, 1, 1, 30), cand(2, 2, 1, 20), cand(3, 3, 1, 25)], [])
      ?.run,
    runId("run", 2),
  );
  // 상위가 없으면 하위 칸이고, 후보가 없으면 없다.
  assertEquals(
    pickCandidate([cand(1, 1, 2, 10), cand(2, 2, 2, 9)], [])?.run,
    runId("run", 2),
  );
  assertEquals(pickCandidate([], []), undefined);
  // 선택은 이름 있는 값을 읽기만 한다. 같은 입력은 같은 답이다.
  const input = [cand(1, 1, 2, 5), cand(2, 2, 1, 6)];
  assertEquals(pickCandidate(input, []), pickCandidate(input, []));
  assertEquals(YIELD_AFTER, 8);
});

Deno.test("lophn-agent/harness/run-loop#R4 [agent-I40]: 우선순위는 둘뿐이라 어떤 계기의 run도 1이나 2이고 셋째 칸이 없다", () => {
  const kinds = [
    { kind: "message", message: "m" },
    { kind: "handoff" },
  ];
  for (const source of kinds) {
    const tier = tierOf({ source: source as never, continued_from: null });
    assert(tier === 1 || tier === 2, `${source.kind} -> ${tier}`);
  }
  assertEquals(
    tierOf({ source: kinds[0] as never, continued_from: null }),
    1,
  );
  assertEquals(
    tierOf({ source: kinds[1] as never, continued_from: null }),
    2,
  );
  // 사람이 다시 맡긴 요청(continued_from)은 한 번짜리 일이다.
  assertEquals(
    tierOf({ source: kinds[0] as never, continued_from: "run_x" }),
    2,
  );
});

Deno.test("lophn-agent/harness/run-loop#R4: 상위 일 8개를 연속으로 시작한 뒤에는 가장 오래 기다린 하위 후보가 다음 자리를 받는다", () => {
  const waiting = [cand(1, 1, 1, 100), cand(2, 2, 2, 50)];
  // 접수(seq 50) 뒤 상위 시작이 7개면 아직 상위 차례다.
  assertEquals(pickCandidate(waiting, upper(60, 7))?.reason, "priority");
  assertEquals(pickCandidate(waiting, upper(60, 7))?.run, runId("run", 1));
  // 8개 연속이면 하위 차례다.
  const yielded = pickCandidate(waiting, upper(60, 8));
  assertEquals(yielded?.run, runId("run", 2));
  assertEquals(yielded?.reason, "yield");
  // 하위를 시작하면 연속이 끊겨 다시 상위 차례다.
  assertEquals(
    pickCandidate(waiting, [...upper(60, 8), ...starts([70, 2])])?.reason,
    "priority",
  );
  // 하위가 끼어 있던 7개 앞의 시작은 연속에 들지 않는다.
  assertEquals(
    pickCandidate(waiting, [
      ...upper(60, 5),
      ...starts([66, 2]),
      ...upper(67, 7),
    ])
      ?.reason,
    "priority",
  );
  // 하위 후보가 접수되기 전의 시작은 기다린 시간이 아니다.
  assertEquals(
    pickCandidate(
      [cand(1, 1, 1, 100), cand(2, 2, 2, 99)],
      upper(10, 12),
    )?.reason,
    "priority",
  );
  // 상위 후보가 없으면 양보가 아니라 그냥 그 후보다.
  assertEquals(
    pickCandidate([cand(2, 2, 2, 50)], upper(60, 20))?.reason,
    "priority",
  );
});

function accepted(
  run: number,
  assignment: number,
  seq: number,
  extra: Record<string, unknown> = {},
) {
  return ({
    id: runId("run", run),
    assignment: runId("asg", assignment),
    session: null,
    source: { kind: "message", message: "m" },
    continued_from: null,
    start_after: null,
    start_confirmed_seq: null,
    state: "accepted",
    accepted_seq: String(seq),
    state_seq: String(seq),
    ...extra,
  }) as never;
}

const sessionOf = (n: number) => runId("ses", n);
const enabledAll = new Set([
  runId("asg", 1),
  runId("asg", 2),
  runId("asg", 3),
]);

Deno.test("lophn-agent/harness/run-loop#R4: 막힌 session의 후보는 양보를 받지도 쓰지도 않는다", () => {
  const lower = { continued_from: runId("run", 90) };
  // session 2에 진행 중 run이 있어 막혔다. 하위 후보가 있어도 후보가 아니다.
  const blockedLower = startableCandidates({
    accepted: [
      accepted(1, 1, 100, { session: sessionOf(1) }),
      accepted(2, 1, 50, { session: sessionOf(2), ...lower }),
    ],
    enabled: enabledAll,
    live: new Set([
      queueKeyOf({ assignment: runId("asg", 1), session: sessionOf(2) }),
    ]),
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
      accepted(1, 1, 100, { session: sessionOf(1) }),
      accepted(2, 1, 50, { session: sessionOf(2), ...lower }),
    ],
    enabled: enabledAll,
    live: new Set(),
    predecessor: () => undefined,
  });
  assertEquals(pickCandidate(freed, upper(60, 8))?.run, runId("run", 2));
  // 멈춘·회수한 assignment, 선행이 허락하지 않은 run도 후보가 아니다. 같은 session은 맨 앞 하나다.
  const gated = startableCandidates({
    accepted: [
      accepted(3, 1, 10, {
        session: sessionOf(1),
        start_after: runId("run", 9),
      }),
      accepted(4, 1, 11, { session: sessionOf(1) }),
      accepted(5, 1, 12, { session: sessionOf(1) }),
      accepted(6, 3, 13, { session: sessionOf(3) }),
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
});

Deno.test("lophn-agent/harness/run-loop#R3 [agent-I40]: 후보는 같은 assignment라도 session마다 하나씩이고 진행 중인 session만 막힌다", () => {
  const asg = runId("asg", 1);
  const key = (session: number | null) =>
    queueKeyOf({
      assignment: asg,
      session: session === null ? null : sessionOf(session),
    });
  const queue = [
    accepted(1, 1, 10, { session: sessionOf(1) }),
    accepted(2, 1, 11, { session: sessionOf(1) }),
    accepted(3, 1, 12, { session: sessionOf(2) }),
    accepted(4, 1, 13, { session: sessionOf(3) }),
  ];
  const pick = (live: Set<string>) =>
    startableCandidates({
      accepted: queue,
      enabled: enabledAll,
      live,
      predecessor: () => undefined,
    });
  // 아무도 진행 중이 아니면 session마다 맨 앞 하나씩이다(session 1의 둘째는 오지 않는다).
  const all = pick(new Set());
  assertEquals(all.map((item) => item.run).sort(), [
    runId("run", 1),
    runId("run", 3),
    runId("run", 4),
  ]);
  assertEquals(all.map((item) => item.session).sort(), [
    sessionOf(1),
    sessionOf(2),
    sessionOf(3),
  ]);
  // session 1이 진행 중이면 그 session만 빠진다. 같은 assignment의 다른 session은 남는다.
  assertEquals(
    pick(new Set([key(1)])).map((item) => item.run).sort(),
    [runId("run", 3), runId("run", 4)],
  );
  // session 없는 진행 중 run은 session 있는 후보를 막지 않는다.
  assertEquals(pick(new Set([key(null)])).length, 3);
  // 선택은 접수 순서 FIFO다: 가장 오래된 session의 맨 앞이 먼저다.
  assertEquals(pickCandidate(all, [])?.run, runId("run", 1));
  assertEquals(
    pickCandidate(pick(new Set([key(1)])), [])?.run,
    runId("run", 3),
  );
});

Deno.test("lophn-agent/harness/run-loop#R3 [agent-I40]: session 없는 run은 assignment 단위로 후보 하나이고 진행 중이면 막힌다", () => {
  const asg = runId("asg", 1);
  const queue = [
    accepted(1, 1, 10, { continued_from: runId("run", 90) }),
    accepted(2, 1, 11, { continued_from: runId("run", 90) }),
    accepted(3, 2, 12, { continued_from: runId("run", 90) }),
  ];
  const pick = (live: Set<string>) =>
    startableCandidates({
      accepted: queue,
      enabled: enabledAll,
      live,
      predecessor: () => undefined,
    });
  // 같은 assignment의 session 없는 run 둘은 맨 앞 하나만 후보고, 다른 assignment는 따로다.
  assertEquals(pick(new Set()).map((item) => item.run), [
    runId("run", 1),
    runId("run", 3),
  ]);
  // assignment의 session 없는 run이 진행 중이면 그 assignment의 session 없는 후보는 없다.
  assertEquals(
    pick(new Set([queueKeyOf({ assignment: asg, session: null })])).map((
      item,
    ) => item.run),
    [runId("run", 3)],
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
        session: null,
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
        session: null,
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
    await pauseAssignmentFixture(h, ASG_CE);
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

Deno.test("lophn-agent/harness/run-loop#R3 [agent-I40]: 실제 ledger에서 같은 lophn assignment의 다른 session은 진행 중인 session을 기다리지 않는다", async () => {
  const h = await openRunLedger();
  try {
    await seedAssignments(h);
    const selector = createRunSelector({ read: ledgerRead(h) });
    const ses = (n: number) => runId("ses", n);
    const accept = (run: number, message: number, session: number) =>
      acceptRun(h, {
        run: runId("run", run),
        source: MSG(message),
        session: ses(session),
      });
    // session 1이 진행 중이고 그 session의 다음 요청이 기다린다.
    must(await accept(1, 1, 1));
    must(await startRunFixture(h, runId("run", 1), ASG_LOPHN));
    must(await accept(2, 2, 1));
    assertEquals(must(await selector.next()), null);
    // 같은 assignment의 session 2 요청은 기다리지 않고 후보가 된다.
    must(await accept(3, 3, 2));
    const other = must(await selector.next());
    assertEquals(other?.run, runId("run", 3));
    assertEquals(other?.assignment, ASG_LOPHN);
    must(await startRunFixture(h, runId("run", 3), ASG_LOPHN));
    // 두 session이 모두 진행 중이면 session 1의 다음 요청도 session 2의 다음 요청도 후보가 아니다.
    must(await accept(4, 4, 2));
    assertEquals(must(await selector.next()), null);
    // session 2가 끝나면 session 2의 다음 요청만 후보다. session 1은 아직 진행 중이다.
    must(
      await finishRunFixture(h, runId("run", 3), {
        kind: "completed",
        reason: "answer_completed",
      }),
    );
    assertEquals(must(await selector.next())?.run, runId("run", 4));
    // session 1이 끝나면 둘 다 후보가 되고 접수가 오래된 session 1의 요청이 먼저다.
    must(
      await finishRunFixture(h, runId("run", 1), {
        kind: "completed",
        reason: "answer_completed",
      }),
    );
    assertEquals(must(await selector.next())?.run, runId("run", 2));
  } finally {
    await h.close();
  }
});
