// 닫힘 command의 실제 executor 경로(problems/closing#R4, R5, R14)와 닫히지 않는 근거
// (problems/closing#R2, R3), 닫기 거절(problems/closing#R1, problem-codes#R7). 실제 임시
// ledger의 executor 위에서 제품과 같은 RecordReport로 문제를 만들고 CloseProblemVerified를
// 낸다. verified 근거 행은 problems/tests fixture가 하는 일의 줄임인 시험 command가 심는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";
import {
  APP_A,
  APP_B,
  COLLECTOR,
  reportInput,
  rpt,
} from "../grouping/testing/mod.ts";
import { CLOSING_EVENT_TYPES } from "./work.ts";

const registration = [
  new URL("../grouping/testing/mod.ts", import.meta.url),
  new URL("./testing/mod.ts", import.meta.url),
];
const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5fa2";
const REL_BEFORE = "rel_01arz3ndektsv4rrffq69g5fa1";
const PROBLEM_OTHER = "prb_01arz3ndektsv4rrffq69g5fa9";
const MISSING_VRF = "vrf_01arz3ndektsv4rrffq69g5fa8";
const VRF = "vrf_01arz3ndektsv4rrffq69g5fa1";

let serial = 0;
const key = (name: string) => `${name}-${++serial}`;

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string): void {
  assert(!result.ok, "실패해야 한다");
  assertEquals(result.error.code, expected);
}

async function open(...extra: AuthenticatedContext[]): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: registration,
      credentials: [COLLECTOR, MACHINE, ...extra],
      nowMs: NOW_MS,
    }),
  );
}

const MACHINE: AuthenticatedContext = {
  principal: "machine:releaser",
  actor: "machine",
  scope: {
    operations: [
      "RecordReport",
      "CloseProblemVerified",
      "problems.testing.verify",
      "problems.testing.activate",
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: "cred-closing",
};

async function newProblem(
  h: LedgerHarness,
  app = APP_A,
): Promise<{ problem: string; report: string }> {
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
  const result = sent.result as { problem: string };
  return { problem: result.problem, report: rpt(serial) };
}

// verified 근거 행이다. 실제 RecordVerification이 하는 일의 줄임이다.
async function seedVerification(
  h: LedgerHarness,
  input: {
    id: string;
    problem: string;
    basis_seq: string;
    after_release: string;
    kind?: string;
    result?: string;
    app?: string;
  },
): Promise<void> {
  value(
    await h.command(MACHINE, {
      command: "problems.testing.verify",
      input,
      compare: {},
      idempotency_key: key("verify"),
      prepared: [],
    } as never),
  );
}

async function arrangeActive(
  h: LedgerHarness,
  app: string,
  release: string,
): Promise<void> {
  value(
    await h.command(MACHINE, {
      command: "problems.testing.activate",
      input: { app, release },
      compare: {},
      idempotency_key: key("activate"),
      prepared: [],
    } as never),
  );
}

type State = { status: string; closure: string | null; seq: string };

async function stateOf(h: LedgerHarness, problem: string): Promise<State> {
  const rows = value(
    await h.inspect(
      `select status, closure,
              (select cast(max(seq) as text) from events where subject = p.id) as seq
         from problems p where id = ?`,
      [problem],
    ),
  );
  const row = rows[0];
  if (row === undefined) return { status: "", closure: null, seq: "0" };
  return {
    status: String(row["status"]),
    closure: row["closure"] === null ? null : String(row["closure"]),
    seq: String(row["seq"]),
  };
}

async function problemClosedEvents(
  h: LedgerHarness,
  problem: string,
): Promise<Record<string, unknown>[]> {
  const rows = value(
    await h.inspect(
      `select payload from events
        where subject = ? and type = 'ProblemClosed' order by seq`,
      [problem],
    ),
  );
  return rows.map((row) =>
    JSON.parse(String(row["payload"])) as Record<string, unknown>
  );
}

function closeEnvelope(
  input: {
    problem: string;
    verification: string;
    problem_seq: string;
    release: string;
  },
): Record<string, unknown> {
  return {
    command: "CloseProblemVerified",
    input,
    compare: { problem_seq: input.problem_seq, release: input.release },
    idempotency_key: key("close"),
    prepared: [],
  };
}

async function closeCall(
  h: LedgerHarness,
  problem: string,
  verification: string,
  release: string,
  compare?: { problem_seq: string; release: string },
) {
  const state = await stateOf(h, problem);
  return await h.command(
    MACHINE,
    closeEnvelope({
      problem,
      verification,
      problem_seq: compare?.problem_seq ?? state.seq,
      release: compare?.release ?? release,
    }) as never,
  );
}

// basis 뒤 같은 문제의 새 live Report 하나를 접수한다. 기존 문제의 group_key를 원장에서
// 받아 그대로 접수한다(exception key는 그것 그대로다).
async function newLiveReport(
  h: LedgerHarness,
  problem: string,
  basisSeq: string,
): Promise<void> {
  const keyRows = value(
    await h.inspect("select group_key from problems where id = ?", [problem]),
  );
  const groupKey = JSON.parse(String(keyRows[0]!["group_key"])) as Record<
    string,
    unknown
  >;
  serial++;
  const spec = reportInput({ serial });
  value(
    await h.command(COLLECTOR, {
      command: "RecordReport",
      input: { ...spec, group_key: groupKey },
      compare: {
        active_release: null,
        problem_seq: basisSeq,
      },
      idempotency_key: key("record"),
      prepared: [],
    } as never),
  );
}

Deno.test("problems/closing#R4 R5 R14: closes when after is the active release and no new live report follows, and a stale seq or release is a conflict", async () => {
  const h = await open();
  try {
    const { problem } = await newProblem(h);
    const state = await stateOf(h, problem);
    assertEquals([state.status, state.closure], ["open", null]);
    await seedVerification(h, {
      id: VRF,
      problem,
      basis_seq: state.seq,
      after_release: REL_AFTER,
    });
    // after가 활성 release가 아니면 닫지 않는다(R4).
    code(await closeCall(h, problem, VRF, REL_AFTER), "conflict");
    // 고친 release를 활성화하면 닫힌다.
    await arrangeActive(h, APP_A, REL_AFTER);
    const done = value(await closeCall(h, problem, VRF, REL_AFTER));
    const closure = (done.result as {
      closure: { reason: string; release: string; verification: string };
    }).closure;
    assertEquals(closure.reason, "verified");
    assertEquals(closure.release, REL_AFTER);
    assertEquals(closure.verification, VRF);
    const now = await stateOf(h, problem);
    assertEquals(now.status, "closed");
    // 닫을 때 ProblemClosed를 낸다.
    const closed = await problemClosedEvents(h, problem);
    assertEquals(closed.length, 1);
    assertEquals(closed[0]!["closure"], JSON.parse(now.closure!));

    // 이미 닫힌 문제는 다시 닫지 않고 event도 늘지 않는다.
    code(await closeCall(h, problem, VRF, REL_AFTER), "conflict");
    assertEquals((await problemClosedEvents(h, problem)).length, 1);

    // 낡은 seq·release로 보낸 요청은 conflict다(R5, R14).
    const { problem: second } = await newProblem(h);
    const secondBasis = (await stateOf(h, second)).seq;
    await seedVerification(h, {
      id: "vrf_01arz3ndektsv4rrffq69g5fa3",
      problem: second,
      basis_seq: secondBasis,
      after_release: REL_AFTER,
    });
    code(
      await closeCall(h, second, "vrf_01arz3ndektsv4rrffq69g5fa3", REL_AFTER, {
        problem_seq: "1",
        release: REL_AFTER,
      }),
      "conflict",
    );
    code(
      await closeCall(h, second, "vrf_01arz3ndektsv4rrffq69g5fa3", REL_BEFORE),
      "conflict",
    );
    assertEquals((await stateOf(h, second)).status, "open");
  } finally {
    await h.close();
  }
});

Deno.test("problems/closing#R4: a new live report after the basis blocks the close, including a late previous-release report", async () => {
  const h = await open();
  try {
    const { problem } = await newProblem(h);
    const basisSeq = (await stateOf(h, problem)).seq;
    await seedVerification(h, {
      id: VRF,
      problem,
      basis_seq: basisSeq,
      after_release: REL_AFTER,
    });
    await arrangeActive(h, APP_A, REL_AFTER);
    // basis 뒤 같은 문제의 새 live Report 하나(늦은 이전 release 보고 포함)가 있으면 닫지 않는다(R4).
    await newLiveReport(h, problem, basisSeq);
    code(await closeCall(h, problem, VRF, REL_AFTER), "conflict");
    assertEquals((await stateOf(h, problem)).status, "open");
    // 근거 뒤 새 보고가 사라지지 않으므로 재시도도 같다(R5: quiet 대기 없음, 만료 없음).
    code(await closeCall(h, problem, VRF, REL_AFTER), "conflict");
  } finally {
    await h.close();
  }
});

Deno.test("problems/closing#R3: an app_test or test_command pass and a fail do not close, and a foreign problem or missing verification is not found", async () => {
  const h = await open();
  try {
    const { problem } = await newProblem(h);
    const basisSeq = (await stateOf(h, problem)).seq;
    await arrangeActive(h, APP_A, REL_AFTER);
    // app test·test command 통과는 verified 근거가 아니다(R3).
    await seedVerification(h, {
      id: "vrf_01arz3ndektsv4rrffq69g5fa1",
      problem,
      basis_seq: basisSeq,
      after_release: REL_AFTER,
      kind: "app_test",
    });
    code(
      await closeCall(h, problem, "vrf_01arz3ndektsv4rrffq69g5fa1", REL_AFTER),
      "invalid_input",
    );
    await seedVerification(h, {
      id: "vrf_01arz3ndektsv4rrffq69g5fa2",
      problem,
      basis_seq: basisSeq,
      after_release: REL_AFTER,
      kind: "test_command",
    });
    code(
      await closeCall(h, problem, "vrf_01arz3ndektsv4rrffq69g5fa2", REL_AFTER),
      "invalid_input",
    );
    // reproduction fail도 후보가 아니다(R3).
    await seedVerification(h, {
      id: "vrf_01arz3ndektsv4rrffq69g5fa3",
      problem,
      basis_seq: basisSeq,
      after_release: REL_AFTER,
      result: "fail",
    });
    code(
      await closeCall(h, problem, "vrf_01arz3ndektsv4rrffq69g5fa3", REL_AFTER),
      "invalid_input",
    );
    assertEquals((await stateOf(h, problem)).status, "open");

    // 다른 앱의 자기 근거는 닫히고, 없는 Verification·없는 문제는 같은 not_found다.
    const { problem: otherAppProblem } = await newProblem(h, APP_B);
    const otherBasis = (await stateOf(h, otherAppProblem)).seq;
    const otherAfter = "rel_01arz3ndektsv4rrffq69g5fay";
    await seedVerification(h, {
      id: "vrf_01arz3ndektsv4rrffq69g5fa5",
      problem: otherAppProblem,
      basis_seq: otherBasis,
      after_release: otherAfter,
      app: APP_B,
    });
    await arrangeActive(h, APP_B, otherAfter);
    const foreign = await h.command(
      MACHINE,
      closeEnvelope({
        problem: otherAppProblem,
        verification: "vrf_01arz3ndektsv4rrffq69g5fa5",
        problem_seq: otherBasis,
        release: otherAfter,
      }) as never,
    );
    assert(foreign.ok, "다른 앱의 자기 근거는 닫힌다");
    const missing = [
      // 없는 Verification.
      await h.command(
        MACHINE,
        closeEnvelope({
          problem: otherAppProblem,
          verification: MISSING_VRF,
          problem_seq: (await stateOf(h, otherAppProblem)).seq,
          release: otherAfter,
        }) as never,
      ),
      // 없는 문제.
      await h.command(
        MACHINE,
        closeEnvelope({
          problem: PROBLEM_OTHER,
          verification: "vrf_01arz3ndektsv4rrffq69g5fa5",
          problem_seq: "1",
          release: otherAfter,
        }) as never,
      ),
    ];
    const first = missing[0]!;
    assert(!first.ok, "실패해야 한다");
    const notFoundCode = first.error.code;
    for (const result of missing) {
      assertEquals(result.ok ? "ok" : result.error.code, notFoundCode);
    }
  } finally {
    await h.close();
  }
});

Deno.test("problems/closing#R1 problem-codes#R7: agent, app and user close attempts are forbidden and fixer=user grants nothing", async () => {
  const agent: AuthenticatedContext = {
    principal: "agent:asg_01arz3ndektsv4rrffq69g5fa1",
    actor: "agent:asg_01arz3ndektsv4rrffq69g5fa1",
    scope: { operations: ["CloseProblemVerified"], targets: {} },
    conditions: {},
    credential_ref: "cred-agent",
  };
  const appActor: AuthenticatedContext = {
    principal: `app:${APP_A}`,
    actor: `app:${APP_A}`,
    scope: { operations: ["CloseProblemVerified"], targets: {} },
    conditions: {},
    credential_ref: "cred-app",
  };
  const user: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: { operations: ["CloseProblemVerified"], targets: {} },
    conditions: {},
    credential_ref: "cred-user",
  };
  const h = await open(agent, appActor, user);
  try {
    const { problem } = await newProblem(h);
    const basisSeq = (await stateOf(h, problem)).seq;
    await seedVerification(h, {
      id: VRF,
      problem,
      basis_seq: basisSeq,
      after_release: REL_AFTER,
    });
    await arrangeActive(h, APP_A, REL_AFTER);
    // 근거가 모두 충족해도 machine이 아니면 forbidden이다(R1).
    for (const who of [agent, appActor, user]) {
      const refused = await h.command(
        who,
        closeEnvelope({
          problem,
          verification: VRF,
          problem_seq: basisSeq,
          release: REL_AFTER,
        }) as never,
      );
      assertFalse(refused.ok);
      assertEquals(refused.error.code, "forbidden");
    }
    // 문제는 그대로고(닫히지 않는다), fixer=user 선언도 권한을 주지 않는다(problem-codes#R7:
    // 이 user credential이 fixer=user 문제를 닫지 못한다).
    assertEquals((await stateOf(h, problem)).status, "open");
    // machine만 같은 요청을 닫는다.
    const done = value(await closeCall(h, problem, VRF, REL_AFTER));
    assertEquals(
      (done.result as { closure: { reason: string } }).closure.reason,
      "verified",
    );
  } finally {
    await h.close();
  }
});

Deno.test("problems/closing#R2: completion and claim signals alone never close, and closure events are not candidates", async () => {
  const h = await open();
  try {
    const { problem } = await newProblem(h);
    // release 준비·activation 시작·앱 시작·command 성공·app test·test command·
    // ticket 완료·고친 기록·앱 주장 event는 반응기가 후보로 읽는 event가 아니다.
    // 활성화만 남겨도 verified 근거 없이는 닫히지 않는다(R2).
    await arrangeActive(h, APP_A, REL_AFTER);
    assertEquals((await stateOf(h, problem)).status, "open");
    assert(CLOSING_EVENT_TYPES.includes("VerificationRecorded"));
    assert(CLOSING_EVENT_TYPES.includes("ReleaseActivated"));
    assert(CLOSING_EVENT_TYPES.includes("ProblemObserved"));
  } finally {
    await h.close();
  }
});
