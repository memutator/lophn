// 해석 연결(problems/grouping#R13, R14; 질문 Q13). 실제 임시 ledger executor 위에서 담당 App Engineer만
// 고정 version·절을 잇고 풀며, 상태는 그대로이고, 이전 참조는 event에 남고, 같은 이전 상태를 읽은 뒤의
// 변경은 conflict이며, lophn-agent ToolCall 성공과 같은 transaction에서 부를 수 있는지 본다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  APP_A,
  APP_B,
  COLLECTOR,
  reportInput,
} from "../problems/grouping/testing/mod.ts";
import { createLedgerHarness, type LedgerHarness } from "./ledger.ts";

const registration = new URL(
  "./problems-interpretation-registration_test.ts",
  import.meta.url,
);
const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");
const AE_A = "asg_01arz3ndektsv4rrffq69g5fa1";
const AE_B = "asg_01arz3ndektsv4rrffq69g5fa2";
const LOPHN = "asg_01arz3ndektsv4rrffq69g5fa3";
const PAUSED = "asg_01arz3ndektsv4rrffq69g5fa4";
const RUN = "run_01arz3ndektsv4rrffq69g5fa1";
const VER_1 = "ver_01arz3ndektsv4rrffq69g5fa1";
const VER_2 = "ver_01arz3ndektsv4rrffq69g5fa2";
const OPERATIONS = ["LinkProblemInterpretation", "problems.testing.tool-call"];

function agent(assignment: string): AuthenticatedContext {
  return {
    actor: `agent:${assignment}`,
    principal: `agent:${assignment}`,
    credential_ref: `test:agent:${assignment}:${RUN}`,
    scope: { operations: OPERATIONS, targets: { assignment, run: RUN } },
    conditions: { assignment, run: RUN },
  };
}

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

async function open(): Promise<
  { h: LedgerHarness; problem: string; other: string }
> {
  const h = value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [
        COLLECTOR,
        agent(AE_A),
        agent(AE_B),
        agent(LOPHN),
        agent(PAUSED),
      ],
      nowMs: NOW_MS,
    }),
  );
  const assign = async (
    id: string,
    role: string,
    app: string | null,
    state = "enabled",
  ) =>
    value(
      await h.command(COLLECTOR, {
        command: "problems.testing.assignment",
        input: { id, role, app, state },
        compare: {},
        idempotency_key: key("assignment"),
        prepared: [],
      }),
    );
  await assign(AE_A, "app_engineer", APP_A);
  await assign(AE_B, "app_engineer", APP_B);
  await assign(LOPHN, "lophn", null);
  await assign(PAUSED, "app_engineer", APP_A, "paused");
  const record = async (app: string) => {
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
  };
  return { h, problem: await record(APP_A), other: await record(APP_B) };
}

type Link = { version: string; section: string | null };

async function stateOf(h: LedgerHarness, problem: string) {
  const rows = value(
    await h.inspect(
      `select status, work, interpretation_version as version,
              interpretation_section as section,
              (select cast(max(seq) as text) from events where subject = p.id) as seq
         from problems p where id = ?`,
      [problem],
    ),
  );
  const row = rows[0]!;
  return {
    status: String(row["status"]),
    work: row["work"] === null ? null : String(row["work"]),
    link: row["version"] === null ? null : {
      version: String(row["version"]),
      section: row["section"] === null ? null : String(row["section"]),
    },
    seq: String(row["seq"]),
  };
}

async function link(
  h: LedgerHarness,
  who: string,
  problem: string,
  next: Link | null,
  compare: { problem_seq: string; previous: Link | null },
  command = "LinkProblemInterpretation",
) {
  return await h.command(agent(who), {
    command,
    input: command === "LinkProblemInterpretation"
      ? { problem, interpretation: next }
      : { id: key("tool"), problem, interpretation: next },
    compare,
    idempotency_key: key("link"),
    prepared: [],
  });
}

async function linkedEvents(h: LedgerHarness, problem: string) {
  const rows = value(
    await h.inspect(
      `select payload from events
        where subject = ? and type = 'ProblemInterpretationLinked' order by seq`,
      [problem],
    ),
  );
  return rows.map((row) => JSON.parse(String(row["payload"])));
}

Deno.test("problems/grouping#R13: the assigned App Engineer links and unlinks a fixed version and section without changing the status and earlier refs stay in events", async () => {
  const { h, problem } = await open();
  try {
    // 고치는 중인 문제도 해석 연결은 진행을 바꾸지 못한다.
    value(
      await h.command(COLLECTOR, {
        command: "problems.testing.arrange",
        input: {
          problem,
          status: "fixing",
          work: "tkt_01arz3ndektsv4rrffq69g5fa1",
          closure: null,
          interpretation_version: null,
          interpretation_section: null,
        },
        compare: {},
        idempotency_key: key("arrange"),
        prepared: [],
      }),
    );
    const first: Link = { version: VER_1, section: "cause" };
    let now = await stateOf(h, problem);
    const linked = value(
      await link(h, AE_A, problem, first, {
        problem_seq: now.seq,
        previous: null,
      }),
    );
    assertEquals(linked.result, { interpretation: first });
    now = await stateOf(h, problem);
    assertEquals([now.status, now.work, now.link], [
      "fixing",
      "tkt_01arz3ndektsv4rrffq69g5fa1",
      first,
    ]);
    // 다른 판으로 바꾸면 이전 참조가 event에 남는다.
    const second: Link = { version: VER_2, section: null };
    value(
      await link(h, AE_A, problem, second, {
        problem_seq: now.seq,
        previous: first,
      }),
    );
    now = await stateOf(h, problem);
    value(
      await link(h, AE_A, problem, null, {
        problem_seq: now.seq,
        previous: second,
      }),
    );
    now = await stateOf(h, problem);
    assertEquals([now.status, now.link], ["fixing", null]);
    assertEquals(await linkedEvents(h, problem), [
      { previous: null, current: first },
      { previous: first, current: second },
      { previous: second, current: null },
    ]);
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R14: of two changes that read the same prior state the later one is a conflict", async () => {
  const { h, problem } = await open();
  try {
    const read = await stateOf(h, problem);
    const first: Link = { version: VER_1, section: null };
    value(
      await link(h, AE_A, problem, first, {
        problem_seq: read.seq,
        previous: null,
      }),
    );
    // 같은 이전 상태(seq·참조)를 읽은 뒤의 변경은 낡았다. 현재 연결은 그대로다.
    code(
      await link(h, AE_A, problem, { version: VER_2, section: null }, {
        problem_seq: read.seq,
        previous: null,
      }),
      "conflict",
    );
    // 문제 seq가 최신이어도 읽은 이전 참조가 다르면 conflict다.
    const now = await stateOf(h, problem);
    code(
      await link(h, AE_A, problem, { version: VER_2, section: null }, {
        problem_seq: now.seq,
        previous: null,
      }),
      "conflict",
    );
    assertEquals((await stateOf(h, problem)).link, first);
    assertEquals((await linkedEvents(h, problem)).length, 1);
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R13: only the assigned App Engineer of the problem's app links, and others get the same answer as an absent problem", async () => {
  const { h, problem, other } = await open();
  try {
    const read = await stateOf(h, problem);
    const attempt = { version: VER_1, section: null };
    const compare = { problem_seq: read.seq, previous: null };
    // 다른 앱의 App Engineer와 없는 문제는 같은 not_found다.
    const foreign = await link(h, AE_B, problem, attempt, compare);
    code(foreign, "not_found");
    const missing = await link(
      h,
      AE_A,
      "prb_01arz3ndektsv4rrffq69g5fa9",
      attempt,
      compare,
    );
    code(missing, "not_found");
    assert(!foreign.ok && !missing.ok);
    assertEquals(foreign.error, missing.error);
    code(await link(h, AE_A, other, attempt, compare), "not_found");
    // App Engineer가 아닌 agent와 멈춘 App Engineer는 연결하지 못한다.
    code(await link(h, LOPHN, problem, attempt, compare), "forbidden");
    code(await link(h, PAUSED, problem, attempt, compare), "forbidden");
    assertEquals((await stateOf(h, problem)).link, null);
    assertEquals((await linkedEvents(h, problem)).length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R13: a ToolCall success calls the link in the same transaction and a refused link leaves no trace of the call (Q13)", async () => {
  const { h, problem } = await open();
  try {
    const read = await stateOf(h, problem);
    const target: Link = { version: VER_1, section: "cause" };
    const done = value(
      await link(
        h,
        AE_A,
        problem,
        target,
        { problem_seq: read.seq, previous: null },
        "problems.testing.tool-call",
      ),
    );
    assertEquals(done.result, { linked: true });
    assertEquals((await stateOf(h, problem)).link, target);
    const calls = () => h.inspect("select id from test_tool_calls", []);
    assertEquals(value(await calls()).length, 1);
    // 같은 낡은 기준으로 다시 부르면 해석 연결이 거절되고 ToolCall 기록도 남지 않는다.
    code(
      await link(
        h,
        AE_A,
        problem,
        { version: VER_2, section: null },
        { problem_seq: read.seq, previous: null },
        "problems.testing.tool-call",
      ),
      "conflict",
    );
    assertEquals(value(await calls()).length, 1);
    assertEquals((await stateOf(h, problem)).link, target);
  } finally {
    await h.close();
  }
});
