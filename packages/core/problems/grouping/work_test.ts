// 문제 work 연결(problems/grouping#R8, R9, R14)과 `problems.work` 반응기. 실제 임시 ledger의
// executor 위에서 제품과 같은 RecordReport로 문제를 만들고 ReconcileProblemWork를 낸다. ticket 표와
// ticket event는 coding-agent command가 하는 일의 줄임인 시험 command가 만든다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../testing/ledger.ts";
import { APP_A, APP_B, COLLECTOR, reportInput } from "./testing/mod.ts";
import {
  reactWork,
  WORK_EVENT_TYPES,
  type WorkEvent,
  workReactionKey,
  type WorkReactionPorts,
} from "./work.ts";
import { checkInterpretationLink, type InterpretationReader } from "./mod.ts";

const registration = new URL("./testing/mod.ts", import.meta.url);
const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");
const TICKET_A = "tkt_01arz3ndektsv4rrffq69g5fa1";
const TICKET_B = "tkt_01arz3ndektsv4rrffq69g5fa2";
const TICKET_C = "tkt_01arz3ndektsv4rrffq69g5fa3";

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string): void {
  assert(!result.ok, "실패해야 한다");
  assertEquals(result.error.code, expected);
}

let serial = 0;
const key = (name: string) => `${name}-${++serial}`;

async function open(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [COLLECTOR],
      nowMs: NOW_MS,
    }),
  );
}

async function newProblem(h: LedgerHarness, app = APP_A): Promise<string> {
  serial++;
  const sent = value(
    await h.command(COLLECTOR, {
      command: "RecordReport",
      input: reportInput({ serial, app }),
      compare: { active_release: null, problem_seq: null },
      idempotency_key: key("record"),
      prepared: [],
    }),
  );
  return (sent.result as { problem: string }).problem;
}

async function ticket(
  h: LedgerHarness,
  event: string,
  id: string,
  problems: string[],
  extra: Record<string, unknown> = {},
  app = APP_A,
): Promise<string> {
  const sent = value(
    await h.command(COLLECTOR, {
      command: "problems.testing.ticket-event",
      input: { event, ticket: id, app, problems, ...extra },
      compare: {},
      idempotency_key: key("ticket"),
      prepared: [],
    }),
  );
  return (sent.result as { seq: string }).seq;
}

type State = { status: string; work: string | null; seq: string };

async function stateOf(h: LedgerHarness, problem: string): Promise<State> {
  const rows = value(
    await h.inspect(
      `select status, work,
              (select cast(max(seq) as text) from events where subject = p.id) as seq
         from problems p where id = ?`,
      [problem],
    ),
  );
  const row = rows[0];
  if (row === undefined) return { status: "", work: null, seq: "0" };
  return {
    status: String(row["status"]),
    work: row["work"] === null ? null : String(row["work"]),
    seq: String(row["seq"]),
  };
}

// 문제 기준을 읽은 그대로 compare에 싣는다. 다른 기준을 주려면 compare를 준다.
async function reconcile(
  h: LedgerHarness,
  problem: string,
  id: string,
  eventSeq: string,
  compare?: { problem_seq: string; work: string | null },
) {
  const read = await stateOf(h, problem);
  return await h.command(COLLECTOR, {
    command: "ReconcileProblemWork",
    input: { problem, ticket: id, ticket_event_seq: eventSeq },
    compare: compare ?? { problem_seq: read.seq, work: read.work },
    idempotency_key: key("reconcile"),
    prepared: [],
  });
}

async function workEvents(
  h: LedgerHarness,
  problem: string,
): Promise<{ type: string; payload: Record<string, unknown> }[]> {
  const rows = value(
    await h.inspect(
      `select type, payload from events
        where subject = ? and type in ('ProblemWorkStarted', 'ProblemWorkEnded')
        order by seq`,
      [problem],
    ),
  );
  return rows.map((row) => ({
    type: String(row["type"]),
    payload: JSON.parse(String(row["payload"])) as Record<string, unknown>,
  }));
}

Deno.test("problems/grouping#R9: TicketCreated links work with status open and only a valid claim makes it fixing", async () => {
  const h = await open();
  try {
    const problem = await newProblem(h);
    const fresh = await stateOf(h, problem);
    assertEquals([fresh.status, fresh.work], ["open", null]);
    const created = await ticket(h, "TicketCreated", TICKET_A, [problem]);
    const linked = value(await reconcile(h, problem, TICKET_A, created));
    assertEquals(linked.result, {
      status: "open",
      work: TICKET_A,
      changed: true,
    });
    let now = await stateOf(h, problem);
    assertEquals([now.status, now.work], ["open", TICKET_A]);
    const claimed = await ticket(h, "TicketClaimed", TICKET_A, [problem], {
      claim_seq: "9",
    });
    value(await reconcile(h, problem, TICKET_A, claimed));
    now = await stateOf(h, problem);
    assertEquals([now.status, now.work], ["fixing", TICKET_A]);
    assertEquals(await workEvents(h, problem), [
      {
        type: "ProblemWorkStarted",
        payload: {
          ticket: TICKET_A,
          claim_seq: null,
          ticket_event_seq: created,
        },
      },
      {
        type: "ProblemWorkStarted",
        payload: {
          ticket: TICKET_A,
          claim_seq: "9",
          ticket_event_seq: claimed,
        },
      },
    ]);
    // 같은 사실을 다시 반응하면 바꾸지 않고 event도 없다.
    const again = value(await reconcile(h, problem, TICKET_A, claimed));
    assertEquals(again.result, {
      status: "fixing",
      work: TICKET_A,
      changed: false,
    });
    assertEquals((await workEvents(h, problem)).length, 2);
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R9: release, expiry, report and cancel return to open and a check failure is not a new claim", async () => {
  const h = await open();
  try {
    const problem = await newProblem(h);
    const created = await ticket(h, "TicketCreated", TICKET_A, [problem]);
    value(await reconcile(h, problem, TICKET_A, created));
    const step = async (event: string, extra: Record<string, unknown> = {}) => {
      const seq = await ticket(h, event, TICKET_A, [problem], extra);
      value(await reconcile(h, problem, TICKET_A, seq));
      return await stateOf(h, problem);
    };
    let now = await step("TicketClaimed", { claim_seq: "3" });
    assertEquals(now.status, "fixing");
    // 반납
    now = await step("TicketClaimReleased", { reason: "returned" });
    assertEquals([now.status, now.work], ["open", TICKET_A]);
    // 만료(TicketClaimReleased reason expired), 연결 회수도 같은 해제다.
    await step("TicketClaimed", { claim_seq: "4" });
    now = await step("TicketClaimReleased", { reason: "expired" });
    assertEquals([now.status, now.work], ["open", TICKET_A]);
    await step("TicketClaimed", { claim_seq: "5" });
    now = await step("TicketClaimReleased", { reason: "connection_revoked" });
    assertEquals(now.status, "open");
    // 완료 보고: 닫힘 근거가 없으니 open이고 검사 중이라 ticket은 이어 둔다.
    await step("TicketClaimed", { claim_seq: "6" });
    now = await step("TicketCompletionReported", { claim_seq: "6" });
    assertEquals([now.status, now.work], ["open", TICKET_A]);
    // 검사 실패는 새 claim이 아니다: 그대로 open이고 이어진 ticket도 그대로다.
    const before = (await workEvents(h, problem)).length;
    now = await step("TicketCheckFailed");
    assertEquals([now.status, now.work], ["open", TICKET_A]);
    assertEquals((await workEvents(h, problem)).length, before);
    // 새 claim 뒤에야 다시 fixing이다.
    now = await step("TicketClaimed", { claim_seq: "7" });
    assertEquals(now.status, "fixing");
    // 취소: open이 되고 ticket 연결은 풀린다.
    now = await step("TicketCancelled");
    assertEquals([now.status, now.work], ["open", null]);
    const reasons = (await workEvents(h, problem)).filter((event) =>
      event.type === "ProblemWorkEnded"
    ).map((event) => event.payload["reason"]);
    assertEquals(reasons, [
      "released",
      "expired",
      "released",
      "completion_reported",
      "cancelled",
    ]);
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R9: a confirmed ticket ends the work link without closing, and ticket events never open or close a closed problem", async () => {
  const h = await open();
  try {
    const problem = await newProblem(h);
    const created = await ticket(h, "TicketCreated", TICKET_A, [problem]);
    value(await reconcile(h, problem, TICKET_A, created));
    const confirmed = await ticket(h, "TicketConfirmed", TICKET_A, [problem]);
    value(await reconcile(h, problem, TICKET_A, confirmed));
    // 확인된 ticket은 닫힘 근거가 아니다. 문제는 open이고 work만 풀린다.
    const now = await stateOf(h, problem);
    assertEquals([now.status, now.work], ["open", null]);
    assertEquals(
      (await workEvents(h, problem)).at(-1)?.payload["reason"],
      "confirmed",
    );

    // 닫힌 문제는 ticket event로 열리지 않는다.
    const closed = await newProblem(h);
    value(
      await h.command(COLLECTOR, {
        command: "problems.testing.arrange",
        input: {
          problem: closed,
          status: "closed",
          work: null,
          closure: "{}",
          interpretation_version: null,
          interpretation_section: null,
        },
        compare: {},
        idempotency_key: key("arrange"),
        prepared: [],
      }),
    );
    const open2 = await ticket(h, "TicketCreated", TICKET_B, [closed]);
    value(await reconcile(h, closed, TICKET_B, open2));
    const claimed = await ticket(h, "TicketClaimed", TICKET_B, [closed]);
    value(await reconcile(h, closed, TICKET_B, claimed));
    assertEquals((await stateOf(h, closed)).status, "closed");
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R8: a problem takes at most one open repair ticket and a stale link of an ended ticket is replaced", async () => {
  const h = await open();
  try {
    const problem = await newProblem(h);
    const first = await ticket(h, "TicketCreated", TICKET_A, [problem]);
    value(await reconcile(h, problem, TICKET_A, first));
    const second = await ticket(h, "TicketCreated", TICKET_B, [problem]);
    code(await reconcile(h, problem, TICKET_B, second), "invalid_input");
    assertEquals((await stateOf(h, problem)).work, TICKET_A);
    // 끝난 ticket의 일은 지금 연결된 ticket과 상관없다.
    const ended = await ticket(h, "TicketCancelled", TICKET_B, [problem]);
    const unrelated = value(await reconcile(h, problem, TICKET_B, ended));
    assertEquals(unrelated.result, {
      status: "open",
      work: TICKET_A,
      changed: false,
    });
    // 이어 둔 ticket이 끝났는데 반응을 놓쳤으면 낡은 연결은 새 ticket으로 바뀐다.
    await ticket(h, "TicketCancelled", TICKET_A, [problem]);
    const third = await ticket(h, "TicketCreated", TICKET_C, [problem]);
    const replaced = value(await reconcile(h, problem, TICKET_C, third));
    assertEquals(replaced.result, {
      status: "open",
      work: TICKET_C,
      changed: true,
    });
    assertEquals(
      (await workEvents(h, problem)).at(-2)?.payload["reason"],
      "cancelled",
    );
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R14: a ticket update read from an older problem state is a conflict and an out-of-scope ticket is not found", async () => {
  const h = await open();
  try {
    const problem = await newProblem(h);
    const stale = await stateOf(h, problem);
    const created = await ticket(h, "TicketCreated", TICKET_A, [problem]);
    value(await reconcile(h, problem, TICKET_A, created));
    // 같은 이전 상태를 읽은 두 변경 중 뒤의 것은 conflict다.
    const claimed = await ticket(h, "TicketClaimed", TICKET_A, [problem]);
    code(
      await reconcile(h, problem, TICKET_A, claimed, {
        problem_seq: stale.seq,
        work: null,
      }),
      "conflict",
    );
    code(
      await reconcile(h, problem, TICKET_A, claimed, {
        problem_seq: (await stateOf(h, problem)).seq,
        work: TICKET_B,
      }),
      "conflict",
    );
    assertEquals((await stateOf(h, problem)).status, "open");

    // 다른 앱의 ticket, 구현 ticket, 이 문제를 담지 않은 ticket, 없는 ticket은 같은 not_found다.
    const foreign = await ticket(
      h,
      "TicketCreated",
      TICKET_B,
      [problem],
      {},
      APP_B,
    );
    const impl = await ticket(h, "TicketCreated", TICKET_C, [problem], {
      kind: "implementation",
    });
    const other = await newProblem(h);
    const missing = "tkt_01arz3ndektsv4rrffq69g5fa4";
    const results = [
      await reconcile(h, problem, TICKET_B, foreign),
      await reconcile(h, problem, TICKET_C, impl),
      await reconcile(h, other, TICKET_A, created),
      await reconcile(h, problem, missing, created),
      await reconcile(h, "prb_01arz3ndektsv4rrffq69g5fa5", TICKET_A, created),
    ];
    const first = results[0]!;
    assert(!first.ok);
    assertEquals(first.error.code, "not_found");
    for (const result of results) {
      assert(!result.ok);
      assertEquals(result.error, first.error);
    }
  } finally {
    await h.close();
  }
});

// 반응기: 메모리 ledger 대역이다. event 목록·문제 상태·cursor를 갖고 ports를 낸다.
type Fake = {
  ports: WorkReactionPorts;
  cursor: () => string;
  calls: { key: string; ticket: string; problem: string; seq: string }[];
  failOn?: (call: { ticket: string; seq: string }) => boolean;
};

function fake(
  events: WorkEvent[],
  options: {
    problem?: (problem: string) => { seq: string; work: string | null } | null;
    reconcile?: (n: number) => Result<unknown>;
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
            options.problem
              ? options.problem(problem)
              : { seq: "10", work: null },
          ),
        );
      },
      reconcile(call) {
        calls.push({
          key: call.key,
          ticket: call.input.ticket,
          problem: call.input.problem,
          seq: call.input.ticket_event_seq,
        });
        return Promise.resolve(
          options.reconcile ? options.reconcile(calls.length) : ok({}),
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

const PROBLEM_1 = "prb_01arz3ndektsv4rrffq69g5fa1";
const PROBLEM_2 = "prb_01arz3ndektsv4rrffq69g5fa2";
const event = (
  seq: string,
  type: string,
  subject: string,
  payload: Record<string, unknown>,
): WorkEvent => ({ seq, type, subject, payload });

Deno.test("problems/grouping#R9: the reaction key is (subscriber, cause_seq, reaction) and each ticket event reacts once per problem", async () => {
  const events = [
    event("3", "TicketCreated", TICKET_A, {
      kind: "repair",
      problems: [PROBLEM_1, PROBLEM_2],
    }),
    // 구현 ticket에는 문제가 없다.
    event("4", "TicketCreated", TICKET_B, {
      kind: "implementation",
      problems: [],
    }),
    event("6", "TicketClaimed", TICKET_A, { problems: [PROBLEM_1] }),
    // 이 반응기가 보지 않는 type은 건너뛴다.
    event("7", "TicketMadeReady", TICKET_A, { problems: [PROBLEM_1] }),
  ];
  const world = fake(events);
  const done = value(await reactWork(world.ports, "0"));
  assertEquals(done.processed_through_seq, "7");
  assertEquals(
    world.calls.map((call) => [call.problem, call.ticket, call.seq]),
    [
      [PROBLEM_1, TICKET_A, "3"],
      [PROBLEM_2, TICKET_A, "3"],
      [PROBLEM_1, TICKET_A, "6"],
    ],
  );
  const keys = world.calls.map((call) => call.key);
  assertEquals(new Set(keys).size, 3);
  assertEquals(await workReactionKey("3", PROBLEM_1, "10"), keys[0]);
  assertNotEquals(await workReactionKey("3", PROBLEM_1, "11"), keys[0]);
  assert(WORK_EVENT_TYPES.includes("TicketCheckFailed"));
  assert(WORK_EVENT_TYPES.includes("TicketCreated"));
});

Deno.test("problems/grouping#R9: after a restart the reaction catches up from the saved seq without repeating earlier ones", async () => {
  const events = [
    event("3", "TicketCreated", TICKET_A, {
      kind: "repair",
      problems: [PROBLEM_1],
    }),
    event("5", "TicketClaimed", TICKET_A, { problems: [PROBLEM_1] }),
    event("8", "TicketClaimReleased", TICKET_A, { problems: [PROBLEM_1] }),
  ];
  // 두 번째 반응에서 core가 불가하다. 첫 반응까지의 위치만 남는다.
  let attempts = 0;
  const world = fake(events, {
    reconcile: () =>
      ++attempts === 2
        ? err({ code: "unavailable", message: "core가 불가하다" })
        : ok({}),
  });
  code(await reactWork(world.ports, "0"), "unavailable");
  assertEquals(world.cursor(), "3");
  // 재시작: 남은 위치부터 다시 읽는다. 이미 끝난 seq 3은 다시 반응하지 않는다.
  world.calls.length = 0;
  const resumed = value(await reactWork(world.ports, world.cursor()));
  assertEquals(resumed.processed_through_seq, "8");
  assertEquals(world.calls.map((call) => call.seq), ["5", "8"]);
  assertEquals(world.cursor(), "8");
  // 따라잡은 뒤 다시 돌려도 반응할 것이 없다.
  world.calls.length = 0;
  value(await reactWork(world.ports, world.cursor()));
  assertEquals(world.calls, []);
});

Deno.test("problems/grouping#R14: a stale problem read is read again, and an out-of-scope or over-limit link is confirmed and skipped", async () => {
  const events = [
    event("3", "TicketCreated", TICKET_A, {
      kind: "repair",
      problems: [PROBLEM_1],
    }),
    event("4", "TicketCreated", TICKET_B, {
      kind: "repair",
      problems: [PROBLEM_2],
    }),
  ];
  let reads = 0;
  const conflicted = fake(events, {
    problem: () => ({ seq: String(10 + reads++), work: null }),
    reconcile: (n) =>
      n === 1 ? err({ code: "conflict", message: "문제가 바뀌었다" }) : ok({}),
  });
  value(await reactWork(conflicted.ports, "0"));
  // 첫 반응은 낡은 기준이라 다시 읽고 다른 key로 다시 냈다.
  assertEquals(conflicted.calls.slice(0, 2).map((call) => call.seq), [
    "3",
    "3",
  ]);
  assertNotEquals(conflicted.calls[0]!.key, conflicted.calls[1]!.key);
  assertEquals(conflicted.cursor(), "4");

  const skipping = fake(events, {
    reconcile: (n) =>
      err({
        code: n === 1 ? "invalid_input" : "not_found",
        message: "건너뛴다",
      }),
  });
  assertEquals(
    value(await reactWork(skipping.ports, "0")).processed_through_seq,
    "4",
  );

  // 없는 문제는 반응할 것이 없다.
  const noProblem = fake(events, { problem: () => null });
  value(await reactWork(noProblem.ports, "0"));
  assertEquals(noProblem.calls, []);

  // 계속 낡으면 위치를 올리지 않고 멈춘다.
  const stuck = fake(events, {
    reconcile: () => err({ code: "conflict", message: "문제가 바뀌었다" }),
  });
  code(await reactWork(stuck.ports, "0"), "conflict");
  assertEquals(stuck.cursor(), "0");
  // 권한이 없으면 건너뛰지 않고 멈춘다.
  const forbidden = fake(events, {
    reconcile: () => err({ code: "forbidden", message: "권한이 없다" }),
  });
  code(await reactWork(forbidden.ports, "0"), "forbidden");
  assertEquals(forbidden.cursor(), "0");
});

Deno.test("problems/grouping#R13: the read step lets only a readable version and a found section through", async () => {
  const reader = (
    readable: boolean,
    section: "found" | "missing" | "unsupported" | "unverified" | "whole",
  ): InterpretationReader => ({
    readable: () => Promise.resolve(ok(readable)),
    section: () => Promise.resolve(ok(section)),
  });
  const link = { version: "ver_01arz3ndektsv4rrffq69g5fav", section: "cause" };
  value(await checkInterpretationLink(reader(true, "found"), link));
  // 절 없이 판 전체를 가리키는 연결은 절 확인이 없다.
  value(
    await checkInterpretationLink(reader(true, "missing"), {
      ...link,
      section: null,
    }),
  );
  code(
    await checkInterpretationLink(reader(false, "found"), link),
    "not_found",
  );
  for (
    const state of ["missing", "unsupported", "unverified", "whole"] as const
  ) {
    code(
      await checkInterpretationLink(reader(true, state), link),
      "invalid_input",
    );
  }
});
