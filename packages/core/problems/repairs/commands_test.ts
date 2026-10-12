// 고친 기록의 실제 executor 경로(문제#T14). 임시 파일 SQLite/WAL, writer Worker,
// executor를 그대로 쓴다. ticket claim은 검사 이력의 같은 우선순위를 본는 port
// test double로 본다(check-deps 최상위 경계에서 packages/problems는 coding-agent를
// 받지 못한다).
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../protocol/server/mod.ts";

type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
};
type CommandSuccess = { result: unknown; replayed: boolean };
type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>>;
  read(
    route: { resource: string; method: string },
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  inspect(
    query: string,
    params?: readonly unknown[],
  ): Promise<Result<SqlRow[]>>;
  close(): Promise<void>;
};

async function createLedgerHarness(options: {
  registrationModules: readonly URL[];
  credentials: readonly AuthenticatedContext[];
  nowMs?: number;
}): Promise<Result<LedgerHarness>> {
  const harness = await import("../../testing/ledger.ts");
  return harness.createLedgerHarness(options);
}

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const REL_2 = "rel_00000000000000000000000001";
const VER = "vrf_01arz3ndektsv4rrffq69g5fav";
const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const SUMMARY = "a".repeat(64);
const START = Date.parse("2026-10-06T00:00:00.000Z");
const EXPIRES = "2026-10-06T01:00:00.000Z";
const PROBLEM = "prb_00000000000000000000000001";
const PROBLEM_B = "prb_00000000000000000000000002";

const operations = ["RecordProblemFix", "ListProblemFixes"];
const seedOperations = [...operations, "problems.repairs.seed"];

function credential(actor: string, principal: string): AuthenticatedContext {
  return {
    actor: actor as AuthenticatedContext["actor"],
    principal,
    credential_ref: `test:${principal}`,
    scope: { operations: seedOperations, targets: {} },
    conditions: {},
  };
}

const agent = credential(
  `coding_agent:cac_01arz3ndektsv4rrffq69g5fav`,
  "agent-1",
);
const machine = credential("machine", "machine-1");

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string): void {
  assert(!result.ok, JSON.stringify(result));
  assertEquals(result.error.code, expected);
}

function envelope(
  key: string,
  input: unknown,
  compare: unknown,
): CommandEnvelope {
  return {
    command: "RecordProblemFix",
    input,
    compare,
    idempotency_key: key,
    prepared: [],
  };
}

// 요약 blob은 준비 증거다. ledger harness 시험은 등록 경로의 관측(parallel
// register Blob)이 없어 등록이 거절되지만, hash·purpose 묶음 검사는 input
// schema와 handler가 같은 거절을 본다(contracts#T40).
const SUMMARY_BLOB = {
  preparation: "prep-fix-1",
  principal: `coding_agent:cac_01arz3ndektsv4rrffq69g5fav`,
  purpose: "fix_summary",
  hash: SUMMARY,
  size_bytes: 64,
};

function fixInput(patch: Record<string, unknown> = {}): unknown {
  return {
    problem: PROBLEM,
    idempotency_key: "fix-input-1",
    fix: {
      before: REL,
      after: REL_2,
      summary: SUMMARY,
      verification: [VER],
      ticket: TICKET,
      claim_seq: "3",
      ...patch,
    },
    summary_blob: SUMMARY_BLOB,
  };
}

// 문제·release·verification·ticket 행을 seed한다. probeWrite는 호출마다
// rollback이라 seeding에 못 쓴다. seed command가 등록 command Tx 안에서 commit한다.
async function seed(ledger: LedgerHarness, options: {
  problem?: string;
  app?: string;
  verification?: Record<string, unknown> | null;
  ticket?: boolean;
  claim?: Record<string, unknown> | null;
  ticket_problem?: boolean;
}): Promise<void> {
  const problem = options.problem ?? PROBLEM;
  const app = options.app ?? APP;
  await seedFixture(ledger, {
    problem,
    app,
    verification: options.verification
      ? JSON.stringify(options.verification)
      : JSON.stringify({ id: VER }),
    ticket: options.ticket === false ? null : TICKET,
    claim: options.claim ? JSON.stringify(options.claim) : null,
    ticket_problem: options.ticket_problem !== false,
    before: REL,
    after: REL_2,
  });
}

async function seedFixture(
  ledger: LedgerHarness,
  input: {
    problem: string;
    app: string;
    verification: string | null;
    ticket: string | null;
    claim: string | null;
    ticket_problem: boolean;
    before: string;
    after: string;
  },
): Promise<void> {
  value(
    await ledger.command(
      machine,
      {
        command: "problems.repairs.seed",
        input,
        compare: {},
        idempotency_key: `seed-${input.problem}-${
          input.ticket === null ? "no-ticket" : "ticket"
        }`,
        prepared: [],
      },
    ),
  );
}

async function harness(): Promise<LedgerHarness> {
  const opened = value(
    await createLedgerHarness({
      registrationModules: [
        new URL("./harness-registration_test.ts", import.meta.url),
      ],
      credentials: [agent, machine],
      nowMs: START,
    }),
  );
  return opened;
}

Deno.test("problems/repairs#R1: coding_agent만 기록하고 두 release·summary·작성자·시각을 읽는다", async () => {
  const ledger = await harness();
  try {
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: EXPIRES,
      },
    });
    const seq = value(
      await ledger.inspect(
        "select cast(coalesce(max(seq), 0) as text) as seq from events",
        [],
      ),
    )[0]?.seq;
    const current = String(seq ?? "0");
    // machine은 이 command를 부르지 못한다(executor actor 검사).
    const denied = await ledger.command(
      machine,
      envelope("fix-1", fixInput(), {
        problem_seq: current,
      }),
    );
    code(denied, "forbidden");
    const recorded = value(
      await ledger.command(
        agent,
        envelope("fix-1", fixInput(), {
          problem_seq: current,
        }),
      ),
    );
    assert(recorded.result !== undefined);
    // list-fixes는 두 release·summary·작성자·시각을 읽는다.
    const listed = value(
      await ledger.read(
        { resource: "problems", method: "list-fixes" },
        {
          principal: "agent-1",
          actor: "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
          scope: { operations, targets: {} },
          conditions: {},
          credential_ref: "test:agent-1",
        },
        { problem: PROBLEM },
      ),
    ) as { fixes: { fix: Record<string, unknown> }[]; as_of_seq: string };
    assertEquals(listed.fixes.length, 1);
    assertEquals(listed.fixes[0].fix.before, REL);
    assertEquals(listed.fixes[0].fix.after, REL_2);
    assertEquals(listed.fixes[0].fix.summary, SUMMARY);
    const event = value(
      await ledger.inspect(
        "select actor, at from events where type = 'ProblemFixRecorded' and subject = ?",
        [PROBLEM],
      ),
    )[0];
    assertEquals(String(event?.["actor"]), agent.actor);
    assert(String(event?.["at"]).length > 0);
  } finally {
    await ledger.close();
  }
});

Deno.test("problems/repairs#R1: 다른 앱·준비되지 않은 release는 거절된다", async () => {
  const ledger = await harness();
  try {
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: EXPIRES,
      },
    });
    const current = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    // 다른 앱의 release는 같은 not_found다. fix-2가 이 문제의 날짜를 올리므로
    // 뒤의 제출은 문제 seq를 다시 본다.
    const otherApp = value(
      await ledger.command(
        agent,
        envelope("fix-2", fixInput(), {
          problem_seq: current,
        }),
      ),
    );
    assert(otherApp.result !== undefined);
    const afterFirst = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    // before에 다른 앱 release가 오면 not_found다.
    code(
      await ledger.command(
        agent,
        envelope(
          "fix-3",
          fixInput({ before: "rel_00000000000000000000000009" }),
          { problem_seq: afterFirst },
        ),
      ),
      "not_found",
    );
    // 없는 release도 같은 not_found다.
    code(
      await ledger.command(
        agent,
        envelope(
          "fix-4",
          fixInput({ after: "rel_00000000000000000000000009" }),
          { problem_seq: afterFirst },
        ),
      ),
      "not_found",
    );
  } finally {
    await ledger.close();
  }
});

Deno.test("problems/repairs#R2: 빈 목록도 기록되고 다른 묶음·다른 문제 결과는 거절된다", async () => {
  const ledger = await harness();
  try {
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: EXPIRES,
      },
    });
    const current = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    // 빈 결과 목록의 수리도 기록된다.
    const empty = value(
      await ledger.command(
        agent,
        envelope("fix-5", fixInput({ verification: [] }), {
          problem_seq: current,
        }),
      ),
    );
    assert(empty.result !== undefined);
    // shell 로그는 summary 설명일 뿐이다. problems/tests 결과로 승격되지 않는다.
    const rows = value(
      await ledger.inspect("select count(*) as n from verifications", []),
    )[0];
    assertEquals(Number(rows?.["n"] ?? -1), 1);
  } finally {
    await ledger.close();
  }
});

Deno.test("problems/repairs#R2: 다른 묶음 결과는 거절된다", async () => {
  const ledger = await harness();
  try {
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: EXPIRES,
      },
      verification: { target_bundle_hash: "f".repeat(64) },
    });
    const current = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    code(
      await ledger.command(
        agent,
        envelope("fix-6", fixInput(), {
          problem_seq: current,
        }),
      ),
      "invalid_input",
    );
  } finally {
    await ledger.close();
  }
});

Deno.test("problems/repairs#R2: 다른 문제의 재현 결과는 거절된다", async () => {
  const ledger = await harness();
  try {
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: EXPIRES,
      },
      verification: {
        kind: "reproduction",
        problem: PROBLEM_B,
        before_release: REL,
        after_release: REL_2,
      },
    });
    const current = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    code(
      await ledger.command(
        agent,
        envelope("fix-7", fixInput(), {
          problem_seq: current,
        }),
      ),
      "invalid_input",
    );
  } finally {
    await ledger.close();
  }
});

Deno.test("problems/repairs#R3: 낡은 문제 seq는 conflict이고 이전 기록을 고치지 않는다", async () => {
  const ledger = await harness();
  try {
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: EXPIRES,
      },
    });
    const at0 = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    // 첫 기록은 at0 기준으로 통과하고
    const first = value(
      await ledger.command(
        agent,
        envelope("fix-8", fixInput(), {
          problem_seq: at0,
        }),
      ),
    );
    assert(first.result !== undefined);
    // 같은 at0 기준의 두 번째 제출은 낡았다(conflict). patch는 fix 안의 열만 고친다.
    // idempotency_key는 input 최상위 열이라 그대로 둔다. summary patch는 준비 참조의
    // hash도 묶여 있어 같이 고친다(묶음 검사가 parse에서 거절하지 않게).
    code(
      await ledger.command(
        agent,
        envelope(
          "fix-9",
          {
            ...fixInput({ summary: "9".repeat(64) }) as Record<string, unknown>,
            summary_blob: {
              ...SUMMARY_BLOB,
              hash: "9".repeat(64),
            },
          },
          { problem_seq: at0 },
        ),
      ),
      "conflict",
    );
    // append-only: 첫 기록의 summary와 문제 status는 그대로다.
    const stored = value(
      await ledger.inspect(
        "select payload from events where type = 'ProblemFixRecorded' and subject = ? order by seq",
        [PROBLEM],
      ),
    );
    assertEquals(stored.length, 1);
    const payload = JSON.parse(String(stored[0]?.["payload"]));
    assertEquals(payload.summary, SUMMARY);
  } finally {
    await ledger.close();
  }
});

Deno.test("problems/repairs#R4: ticket·claim 누락은 거절되고 과거 null 출처는 읽는다", async () => {
  const ledger = await harness();
  try {
    // claim 없는 ticket이다.
    await seed(ledger, { ticket: true });
    const current = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    code(
      await ledger.command(
        agent,
        envelope("fix-10", fixInput(), {
          problem_seq: current,
        }),
      ),
      "conflict",
    );
  } finally {
    await ledger.close();
  }
  const ledger2 = await harness();
  try {
    // 과거 null 출처 이력은 그 당시 payload 그대로 읽는다.
    value(
      await ledger2.command(
        machine,
        {
          command: "problems.repairs.seed",
          input: {
            problem: PROBLEM,
            app: APP,
            before: null,
            after: null,
            verification: null,
            ticket: null,
            claim: null,
          },
          compare: {},
          idempotency_key: "seed-null-source",
          prepared: [],
        },
      ),
    );
    const listed = value(
      await ledger2.read(
        { resource: "problems", method: "list-fixes" },
        {
          principal: "agent-1",
          actor: "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
          scope: { operations, targets: {} },
          conditions: {},
          credential_ref: "test:agent-1",
        },
        { problem: PROBLEM },
      ),
    ) as { fixes: unknown[] };
    assertEquals(listed.fixes.length, 0);
  } finally {
    await ledger2.close();
  }
});

Deno.test("problems/repairs#R4: 문제 밖 repair ticket은 거절된다", async () => {
  const ledger = await harness();
  try {
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: EXPIRES,
      },
      ticket_problem: false,
    });
    const current = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    code(
      await ledger.command(
        agent,
        envelope("fix-11", fixInput(), {
          problem_seq: current,
        }),
      ),
      "conflict",
    );
  } finally {
    await ledger.close();
  }
});

Deno.test("problems/repairs#R5: 만료·다른 claim seq는 거절되고 현재 claim은 통과한다", async () => {
  const ledger = await harness();
  try {
    // 만료 claim이다.
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: "2026-10-05T23:00:00.000Z",
      },
    });
    const current = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    code(
      await ledger.command(
        agent,
        envelope("fix-12", fixInput(), {
          problem_seq: current,
        }),
      ),
      "conflict",
    );
  } finally {
    await ledger.close();
  }
  const ledger2 = await harness();
  try {
    // 다른 claim seq다.
    await seed(ledger2, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "4",
        expires_at: EXPIRES,
      },
    });
    const current = String(
      value(
        await ledger2.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    code(
      await ledger2.command(
        agent,
        envelope("fix-13", fixInput(), {
          problem_seq: current,
        }),
      ),
      "conflict",
    );
  } finally {
    await ledger2.close();
  }
});

Deno.test("problems/repairs#R6: 제출이 테스트 결과나 닫힘을 만들지 않는다", async () => {
  const ledger = await harness();
  try {
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: EXPIRES,
      },
    });
    const current = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    value(
      await ledger.command(
        agent,
        envelope("fix-14", fixInput(), {
          problem_seq: current,
        }),
      ),
    );
    // 이 command가 낸 event는 ProblemFixRecorded 하나뿐이다.
    const events = value(
      await ledger.inspect(
        "select distinct type from events where seq > ?",
        [current],
      ),
    );
    assertEquals(events.length, 1);
    assertEquals(String(events[0]?.["type"]), "ProblemFixRecorded");
    // problems.status는 open으로 남고 tickets.state는 claimed으로 남는다.
    const problem = value(
      await ledger.inspect("select status from problems where id = ?", [
        PROBLEM,
      ]),
    )[0];
    assertEquals(String(problem?.["status"]), "open");
    const ticket = value(
      await ledger.inspect("select state from tickets where id = ?", [TICKET]),
    )[0];
    assertEquals(String(ticket?.["state"]), "claimed");
  } finally {
    await ledger.close();
  }
});

Deno.test("problems/repairs#R7: release 없이 기록하지 않고 설정 문제는 이 command를 요구하지 않는다", async () => {
  const ledger = await harness();
  try {
    await seed(ledger, {
      ticket: true,
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "3",
        expires_at: EXPIRES,
      },
    });
    const before = value(
      await ledger.inspect("select count(*) as n from releases", []),
    )[0];
    const current = String(
      value(
        await ledger.inspect(
          "select cast(coalesce(max(seq), 0) as text) as seq from events",
          [],
        ),
      )[0]?.seq ?? "0",
    );
    value(
      await ledger.command(
        agent,
        envelope("fix-15", fixInput(), {
          problem_seq: current,
        }),
      ),
    );
    const after = value(
      await ledger.inspect("select count(*) as n from releases", []),
    )[0];
    assertEquals(Number(after?.["n"] ?? -1), Number(before?.["n"] ?? -2));
    // 기록이 verification을 새로 만들지 않는다.
    const verifications = value(
      await ledger.inspect("select count(*) as n from verifications", []),
    )[0];
    assertEquals(Number(verifications?.["n"] ?? -1), 1);
  } finally {
    await ledger.close();
  }
});
