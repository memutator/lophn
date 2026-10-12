// 사람 결정과 재발(problems#T21). 실제 임시 ledger의 executor 위에서 제품과 같은
// RecordReport로 문제를 만들고, 사람 결정 handle을 발급해 ApplyProblemDecision을 낸다.
// handle은 route binding(choice·problem·basis_seq·release·last_report·note)의 내용에
// 묶인다. 활성 release는 closing 시험 fixture command가 바꾼다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  canonicalize,
  formatAt,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";
import { APP_A, COLLECTOR, reportInput } from "../grouping/testing/mod.ts";
import { offersFixedConfirmation } from "./mod.ts";

const registration = [
  new URL("../grouping/testing/mod.ts", import.meta.url),
  new URL("./testing/mod.ts", import.meta.url),
];
const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5fa2";
const REL_BEFORE = "rel_01arz3ndektsv4rrffq69g5fa1";
const LATER = "2026-10-19T12:00:00.000Z";

let serial = 100;
const key = (name: string) => `${name}-${++serial}`;

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string): void {
  assert(!result.ok, "실패해야 한다");
  assertEquals(result.error.code, expected);
}

const credential = (actor: string, ref: string): AuthenticatedContext => ({
  principal: actor === "user" ? "user-1" : actor,
  actor,
  scope: { operations: ["ApplyProblemDecision"], targets: {} },
  conditions: {},
  credential_ref: ref,
});
const USER = credential("user", "cred-user");
const AGENT = credential("agent:asg_01arz3ndektsv4rrffq69g5fav", "cred-agent");
const CODING = credential(
  "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
  "cred-coding",
);
const APP = credential(`app:${APP_A}`, "cred-app");
const MACHINE_DECIDER = credential("machine", "cred-machine-decider");
const MACHINE: AuthenticatedContext = {
  principal: "machine:releaser",
  actor: "machine",
  scope: { operations: ["problems.testing.activate"], targets: {} },
  conditions: {},
  credential_ref: "cred-closing",
};

async function open(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: registration,
      credentials: [
        COLLECTOR,
        MACHINE,
        USER,
        AGENT,
        CODING,
        APP,
        MACHINE_DECIDER,
      ],
      nowMs: NOW_MS,
    }),
  );
}

async function activate(h: LedgerHarness, release: string): Promise<void> {
  value(
    await h.command(MACHINE, {
      command: "problems.testing.activate",
      input: { app: APP_A, release },
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
  const row = rows[0]!;
  return {
    status: String(row["status"]),
    closure: row["closure"] === null ? null : String(row["closure"]),
    seq: String(row["seq"]),
  };
}

async function eventsOf(
  h: LedgerHarness,
  problem: string,
  type: string,
): Promise<Record<string, unknown>[]> {
  const rows = value(
    await h.inspect(
      "select payload from events where subject = ? and type = ? order by seq",
      [problem, type],
    ),
  );
  return rows.map((row) =>
    JSON.parse(String(row["payload"])) as Record<string, unknown>
  );
}

async function count(h: LedgerHarness, table: string): Promise<number> {
  const rows = value(
    await h.inspect(`select count(*) as n from ${table}`, []),
  );
  return Number(rows[0]!["n"]);
}

// 문제를 처음 연 보고다. 같은 문제의 다음 보고는 원장의 group_key를 그대로 쓴다.
async function report(
  h: LedgerHarness,
  options: {
    release?: string | null;
    observedAt?: string;
    problem?: string;
  } = {},
): Promise<{ problem: string; report: string }> {
  serial++;
  const spec = reportInput({
    serial,
    release: options.release === undefined ? REL_AFTER : options.release,
    observedAt: options.observedAt,
  });
  let input = spec;
  let problemSeq: string | null = null;
  if (options.problem !== undefined) {
    const rows = value(
      await h.inspect("select group_key from problems where id = ?", [
        options.problem,
      ]),
    );
    input = { ...spec, group_key: JSON.parse(String(rows[0]!["group_key"])) };
    problemSeq = (await stateOf(h, options.problem)).seq;
  }
  const sent = value(
    await h.command(COLLECTOR, {
      command: "RecordReport",
      input,
      compare: { active_release: null, problem_seq: problemSeq },
      idempotency_key: key("record"),
      prepared: [],
    } as never),
  );
  return {
    problem: (sent.result as { problem: string }).problem,
    report: spec.report.id,
  };
}

type Decision = {
  choice: "fixed" | "not_fixed" | "not_visible" | "dismiss";
  problem: string;
  basis_seq: string;
  release: string | null;
  last_report: string | null;
  note: string | null;
};

// 사람이 결정 화면에서 본 내용 그대로 handle을 발급한다.
async function issue(h: LedgerHarness, decision: Decision): Promise<string> {
  const issued = value(
    await h.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-1",
        target_ref: decision.choice,
        content_hash: await sha256Hex(canonicalize(decision)),
        allowed_decisions: ["ApplyProblemDecision"],
        expires_at: formatAt(NOW_MS + 600_000),
      },
    }),
  ) as { confirmation: string };
  return issued.confirmation;
}

async function decide(
  h: LedgerHarness,
  decision: Decision,
  options: {
    as?: AuthenticatedContext;
    handle?: string | null;
  } = {},
) {
  const handle = options.handle === undefined
    ? await issue(h, decision)
    : options.handle;
  return await h.command(options.as ?? USER, {
    command: "ApplyProblemDecision",
    input: decision,
    compare: { problem_seq: decision.basis_seq, release: decision.release },
    idempotency_key: key("decide"),
    prepared: [],
    ...(handle === null ? {} : { confirmation: handle }),
  } as never);
}

async function decision(
  h: LedgerHarness,
  problem: string,
  choice: Decision["choice"],
  patch: Partial<Decision> = {},
): Promise<Decision> {
  return {
    choice,
    problem,
    basis_seq: (await stateOf(h, problem)).seq,
    release: REL_AFTER,
    last_report: null,
    note: null,
    ...patch,
  };
}

Deno.test("problems/closing#R6 R7 R8: fixed closes as user_confirmed, not_visible as recovered and dismiss as dismissed without a Verification", async () => {
  const h = await open();
  try {
    await activate(h, REL_AFTER);
    const fixed = await report(h);
    const confirmed = value(
      await decide(h, await decision(h, fixed.problem, "fixed")),
    ).result as { status: string; closure: Record<string, unknown> };
    assertEquals(confirmed.status, "closed");
    assertEquals(confirmed.closure["reason"], "user_confirmed");
    assertEquals(confirmed.closure["release"], REL_AFTER);
    assertEquals(confirmed.closure["verification"], null);
    assertNotEquals(confirmed.closure["confirmation"], null);

    // 마지막 live Report가 아닌 보고를 보고 한 "안 보인다"는 받지 않는다(R7).
    const quiet = await report(h, { observedAt: "2026-10-04T11:00:00.000Z" });
    const latest = await report(h, { problem: quiet.problem });
    code(
      await decide(
        h,
        await decision(h, quiet.problem, "not_visible", {
          last_report: quiet.report,
        }),
      ),
      "invalid_input",
    );
    const recovered = value(
      await decide(
        h,
        await decision(h, quiet.problem, "not_visible", {
          last_report: latest.report,
        }),
      ),
    ).result as { closure: Record<string, unknown> };
    assertEquals(recovered.closure["reason"], "recovered");
    assertEquals(recovered.closure["last_report"], latest.report);

    // 무시는 이유가 있어야 하고 dismissed로 닫는다(R8).
    const ignored = await report(h);
    code(
      await decide(
        h,
        await decision(h, ignored.problem, "dismiss", { note: " " }),
      ),
      "invalid_input",
    );
    const dismissed = value(
      await decide(
        h,
        await decision(h, ignored.problem, "dismiss", {
          note: "known third-party outage",
        }),
      ),
    ).result as { closure: Record<string, unknown> };
    assertEquals(dismissed.closure["reason"], "dismissed");
    assertEquals(dismissed.closure["note"], "known third-party outage");

    // 사람 결정은 Verification을 만들지 않고, 닫을 때마다 ProblemClosed를 남긴다.
    assertEquals(await count(h, "verifications"), 0);
    for (const problem of [fixed.problem, quiet.problem, ignored.problem]) {
      assertEquals((await stateOf(h, problem)).status, "closed");
      assertEquals((await eventsOf(h, problem, "ProblemClosed")).length, 1);
    }
  } finally {
    await h.close();
  }
});

Deno.test("problems/closing#R1 R6 R14: a decision needs the user's own handle, and a reused handle or changed release or seq is rejected", async () => {
  const h = await open();
  try {
    await activate(h, REL_AFTER);
    const { problem } = await report(h);
    const fixed = await decision(h, problem, "fixed");
    // 사람 아닌 주체는 결정하지 못한다(R1, R6).
    for (const as of [AGENT, CODING, APP, MACHINE_DECIDER]) {
      code(await decide(h, fixed, { as }), "forbidden");
    }
    // 사람이라도 handle 없이는 결정이 아니다.
    code(await decide(h, fixed, { handle: null }), "forbidden");
    // 다른 내용에 묶인 handle은 쓰지 못한다.
    const other = await issue(h, { ...fixed, note: "different" });
    assert(!(await decide(h, fixed, { handle: other })).ok);

    // 결정 뒤 seq가 바뀌면 그 결정은 낡았다(R14).
    const seen = await issue(h, fixed);
    await report(h, { problem });
    code(await decide(h, fixed, { handle: seen }), "conflict");
    // 결정 뒤 활성 release가 바뀌어도 낡았다(R14).
    const fresh = await decision(h, problem, "fixed");
    const freshHandle = await issue(h, fresh);
    await activate(h, REL_BEFORE);
    code(await decide(h, fresh, { handle: freshHandle }), "conflict");
    await activate(h, REL_AFTER);
    assertEquals((await stateOf(h, problem)).status, "open");

    // 같은 handle은 한 번만 쓴다.
    const once = await decision(h, problem, "fixed");
    const handle = await issue(h, once);
    value(await decide(h, once, { handle }));
    assert(!(await decide(h, once, { handle })).ok);
    assertEquals((await eventsOf(h, problem, "ProblemClosed")).length, 1);
  } finally {
    await h.close();
  }
});

Deno.test("problems/closing#R9 problems/repairs#R7: a person can close without a reproduction and without a new release", async () => {
  const h = await open();
  try {
    await activate(h, REL_AFTER);
    const { problem } = await report(h);
    const releases = await count(h, "releases");
    const done = value(
      await decide(h, await decision(h, problem, "fixed")),
    ).result as { closure: Record<string, unknown> };
    // 지금 활성 release 그대로 닫고, release도 Verification도 새로 생기지 않는다.
    assertEquals(done.closure["reason"], "user_confirmed");
    assertEquals(done.closure["release"], REL_AFTER);
    assertEquals(await count(h, "releases"), releases);
    assertEquals(await count(h, "verifications"), 0);
  } finally {
    await h.close();
  }
});

// 시험 원장의 events를 메모리 DB로 옮겨 제안 판정(동기 read)을 그대로 돌린다.
async function offers(
  h: LedgerHarness,
  problem: string,
  active: string,
  extra: { type: string; subject: string; payload: unknown }[] = [],
): Promise<boolean> {
  const rows = value(
    await h.inspect(
      "select cast(seq as text) as seq, type, subject, payload from events order by seq",
      [],
    ),
  );
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "create table events (seq integer primary key, type text, subject text, payload text)",
    );
    const insert = db.prepare(
      "insert into events (seq, type, subject, payload) values (?, ?, ?, ?)",
    );
    let last = 0;
    for (const row of rows) {
      last = Number(row["seq"]);
      insert.run(
        last,
        String(row["type"]),
        String(row["subject"]),
        String(row["payload"]),
      );
    }
    for (const event of extra) {
      insert.run(
        ++last,
        event.type,
        event.subject,
        JSON.stringify(event.payload),
      );
    }
    const sql = {
      get: (statement: string, params: readonly unknown[] = []) =>
        db.prepare(statement).get(
          ...(params as (string | bigint | number | null)[]),
        ) as Record<string, unknown> | undefined,
    };
    return offersFixedConfirmation(sql, problem, active);
  } finally {
    db.close();
  }
}

Deno.test("problems/closing#R10: not_fixed records a confirmation or reopens, and the same release is not offered fixed again without new evidence", async () => {
  const h = await open();
  try {
    await activate(h, REL_AFTER);
    const { problem } = await report(h);
    assert(await offers(h, problem, REL_AFTER));
    // 열린 문제의 "아직입니다"는 확인 기록만 남기고 열린 채다.
    const still = value(
      await decide(h, await decision(h, problem, "not_fixed")),
    ).result as { status: string; closure: unknown };
    assertEquals([still.status, still.closure], ["open", null]);
    const recorded = await eventsOf(h, problem, "ProblemConfirmationRecorded");
    assertEquals(recorded.length, 1);
    assertEquals(recorded[0]!["choice"], "not_fixed");
    // 같은 release·새 근거 없음이면 다시 제안하지 않는다.
    assertEquals(await offers(h, problem, REL_AFTER), false);
    // release가 바뀌거나 새 근거가 생기면 다시 제안한다.
    assert(await offers(h, problem, REL_BEFORE));
    assert(
      await offers(h, problem, REL_AFTER, [{
        type: "ProblemFixRecorded",
        subject: problem,
        payload: {},
      }]),
    );
    assert(
      await offers(h, problem, REL_AFTER, [{
        type: "VerificationRecorded",
        subject: "vrf_01arz3ndektsv4rrffq69g5fa1",
        payload: { problem },
      }]),
    );

    // 닫힌 문제의 "아직입니다"는 같은 ID로 다시 연다.
    value(await decide(h, await decision(h, problem, "fixed")));
    const closedState = await stateOf(h, problem);
    const reopened = value(
      await decide(h, await decision(h, problem, "not_fixed")),
    ).result as { status: string };
    assertEquals(reopened.status, "open");
    const now = await stateOf(h, problem);
    assertEquals([now.status, now.closure], ["open", null]);
    const events = await eventsOf(h, problem, "ProblemReopened");
    assertEquals(events.length, 1);
    assertEquals(events[0]!["previous"], JSON.parse(closedState.closure!));
    assertEquals(events[0]!["report"], null);
    assertEquals(
      (events[0]!["decision"] as Record<string, unknown>)["choice"],
      "not_fixed",
    );
    assertEquals(await offers(h, problem, REL_AFTER), false);
  } finally {
    await h.close();
  }
});

Deno.test("problems/closing#R7: an open problem does not close just because reports stopped", async () => {
  const h = await open();
  try {
    await activate(h, REL_AFTER);
    // 마지막 보고가 72시간보다 오래되어도 사람 결정이나 검증 없이는 열린 채다.
    const { problem } = await report(h, {
      observedAt: "2026-09-30T12:00:00.000Z",
    });
    const state = await stateOf(h, problem);
    assertEquals([state.status, state.closure], ["open", null]);
    assertEquals((await eventsOf(h, problem, "ProblemClosed")).length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("problems/closing#R11 R12 problems/grouping#R10: a current-release report reopens the same closed problem, an old-release report does not", async () => {
  const h = await open();
  try {
    await activate(h, REL_AFTER);
    // 무시로 닫힌 문제도 지금 release의 새 보고면 같은 ID로 다시 연다(R11).
    const { problem } = await report(h);
    value(
      await decide(
        h,
        await decision(h, problem, "dismiss", { note: "flaky network" }),
      ),
    );
    const closedState = await stateOf(h, problem);
    const again = await report(h, { problem, observedAt: LATER });
    assertEquals(again.problem, problem);
    const now = await stateOf(h, problem);
    assertEquals([now.status, now.closure], ["open", null]);
    const reopened = await eventsOf(h, problem, "ProblemReopened");
    assertEquals(reopened.length, 1);
    assertEquals(reopened[0]!["previous"], JSON.parse(closedState.closure!));
    assertEquals(reopened[0]!["report"], again.report);
    assertEquals(reopened[0]!["decision"], null);
    // 이전 닫힘 이력은 남는다.
    assertEquals((await eventsOf(h, problem, "ProblemClosed")).length, 1);

    // 다시 닫은 뒤 이전 release의 늦은 보고는 닫힘을 바꾸지 않는다(R12).
    value(await decide(h, await decision(h, problem, "fixed")));
    const old = await report(h, { problem, release: REL_BEFORE });
    assertEquals(old.problem, problem);
    assertEquals((await stateOf(h, problem)).status, "closed");
    assertEquals((await eventsOf(h, problem, "ProblemReopened")).length, 1);
    // release를 모르는 보고도 지금 release의 재발로 보지 않는다.
    await report(h, { problem, release: null });
    assertEquals((await stateOf(h, problem)).status, "closed");
  } finally {
    await h.close();
  }
});
