// 세션 시작 summary 조립 시험이다(coding-agent/guides#R21, R22; coding-agent#T35). scripted read
// client로 core 응답을 대역한다. 요약 범위·무변경·실패 전달을 본다. 실제 core·credential은 쓰지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  assembleSessionSummary,
  CLAIM_RULE,
  type SummaryReadClient,
} from "./mod.ts";
import type { Route } from "../../contracts/platform/mod.ts";
import {
  codingAgentSessionSummary,
  connectionShow,
  ticketChecks,
  ticketList,
  ticketShow,
} from "../../contracts/coding-agent/mod.ts";
import { getProblem, listProblems } from "../../contracts/problems/mod.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const TKT = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
const TKT2 = "tkt_01h455vb4pex5v6nkc6gd5fdw2";
const PRB = "prb_01h455vb4pex5v6nkc6gd5fdw1";
const PRB2 = "prb_01h455vb4pex5v6nkc6gd5fdw2";
const AT = "2026-03-02T00:00:00.000Z";

// scripted read client는 route 이름별로 답을 두고 부른 입력을 기록한다. 없는 route는
// 테스트가 부르지 않아야 할 호출이라 실패시킨다(coding-agent/connection/testing의 같은 모양).
type Sent = { name: string; input: unknown };

function scriptedClient(
  handlers: Record<string, (input: unknown) => Result<unknown>>,
): { client: SummaryReadClient; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    client: {
      read(
        route: Route,
        input: unknown,
      ): Promise<Result<unknown>> {
        sent.push({ name: route.name, input });
        const handler = handlers[route.name];
        if (handler === undefined) {
          throw new Error(`예상하지 못한 읽기다: ${route.name}`);
        }
        return Promise.resolve(handler(input));
      },
    },
  };
}

const meta = { as_of_seq: "40", next_cursor: null };

// connection show 응답이다. scope는 요청자가 고른 연결의 것이다.
const connection = (scope: unknown) => ({
  id: CAC,
  label: "session",
  scope,
  principal: `coding_agent:${CAC}`,
  state: "active",
  revision: "3",
});

function problemSummary(patch: Record<string, unknown> = {}) {
  return {
    id: PRB,
    app: APP,
    status: "open",
    symptom: "문제 증상",
    next_action: null,
    seq: "10",
    ...patch,
  };
}

function ticketRow(patch: Record<string, unknown> = {}) {
  return {
    id: TKT,
    app: APP,
    kind: "repair",
    title: "ticket 요약",
    state: "open",
    readiness: "ready",
    problem_count: 1,
    ...patch,
  };
}

// 문제 상세 응답이다. detail의 repair가 hook이 가르는 상태다.
function problemDetail(
  repairState: string,
  patch: Record<string, unknown> = {},
) {
  return {
    problem: {
      id: PRB,
      app: APP,
      status: "open",
      work: null,
      group_key: {
        kind: "declared",
        code: "my_code",
        discriminator: null,
      },
      interpretation: null,
      closure: null,
      seq: "10",
    },
    detail: {
      progress: { state: "open", label: "open" },
      owner: { kind: "coding_agent", label: "coding agent" },
      needed_action: null,
      repair: {
        state: repairState,
        label: repairState,
        needs: [],
        last_check_failed: false,
      },
      result: {
        fix_report: "none",
        fix_report_label: "none",
        tests: { state: "not_run", label: "not run", items: [] },
      },
      closed: null,
    },
    text: null,
    report_count: 1,
    first_observed_at: AT,
    last_observed_at: AT,
    first_release: null,
    last_release: null,
    ...patch,
  };
}

function ticketShown(patch: Record<string, unknown> = {}) {
  return {
    ticket: {
      id: TKT,
      state: "open",
      readiness: "ready",
      needs: [],
      app: APP,
      kind: "repair",
      title: "ticket 제목",
      what: "무엇",
      why: "왜",
      problems: [PRB],
      claim: null,
      completion_seq: null,
      conditions: [],
      references: [],
      adoption_questions: [],
      inspect: [],
      preserve: [],
      revision: "5",
      ...patch,
    },
  };
}

const appScope = { kind: "app", app: APP };

// 앱 하나 범위의 기본 handler 표다.
function baseHandlers(): Record<string, (input: unknown) => Result<unknown>> {
  return {
    [connectionShow.name]: () =>
      ok({ ...meta, connection: connection(appScope) }),
    [listProblems.name]: () => ok({ ...meta, problems: [problemSummary()] }),
    [getProblem.name]: () =>
      ok({ ...meta, ...problemDetail("ready_to_hand_off") }),
    [ticketList.name]: () => ok({ ...meta, tickets: [ticketRow()] }),
    [ticketShow.name]: () => ok({ ...meta, ...ticketShown() }),
    [ticketChecks.name]: () =>
      ok({
        ...meta,
        ticket: TKT,
        completion_seq: null,
        checks: [],
      }),
  };
}

function run(
  client: SummaryReadClient,
  input: { app?: string; cursor?: string } = {},
) {
  return assembleSessionSummary(client, {
    principal: `coding_agent:${CAC}`,
    input,
    now: () => AT,
  });
}

const OUT = codingAgentSessionSummary.output;

// 요약 값이 output schema로 검증되는지 확인한다. 응답이 contract 따위가 아니면
// caller가 invalid 응답을 그대로 받는다면 시험에서 잡는다.
Deno.test("coding-agent/guides#R21: 시작 summary는 범위 안 open·fixing 문제와 open·check_failed ticket 요약, 내 claim·기한, 남은 검사 조건과 next_cursor를 내고 출력이 contract에 맞는다", async () => {
  const s = scriptedClient({
    ...baseHandlers(),
    // fixing 문제와 check_failed ticket도 범위 안이다. list는 상태 하나만 받으므로
    // handler가 상태별로 거른다.
    [listProblems.name]: (input) => {
      const status = (input as { status?: string }).status;
      const wanted = status === "fixing"
        ? [problemSummary({ id: PRB2, status: "fixing", seq: "12" })]
        : status === "open"
        ? [problemSummary()]
        : [];
      return ok({ ...meta, problems: wanted });
    },
    [ticketList.name]: (input) => {
      const state = (input as { state?: string }).state;
      if (state === "open") {
        return ok({ ...meta, tickets: [ticketRow()] });
      }
      if (state === "check_failed") {
        return ok({
          ...meta,
          tickets: [ticketRow({ id: TKT2, state: "check_failed" })],
        });
      }
      return ok({ ...meta, tickets: [] });
    },
    [getProblem.name]: (input) => {
      const id = (input as { problem: string }).problem;
      return ok({
        ...meta,
        ...problemDetail("ready_to_hand_off", {
          problem: {
            id,
            app: APP,
            status: id === PRB2 ? "fixing" : "open",
            work: id === PRB2 ? TKT : null,
            group_key: {
              kind: "declared",
              code: "my_code",
              discriminator: null,
            },
            interpretation: null,
            closure: null,
            seq: "10",
          },
        }),
      });
    },
    [ticketShow.name]: (input) =>
      ok({
        ...meta,
        ...ticketShown({
          id: (input as { ticket: string }).ticket,
          state: (input as { ticket: string }).ticket === TKT2
            ? "check_failed"
            : "open",
        }),
      }),
  });
  const got = await run(s.client);
  assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
  const summary = got.value.summary;
  // 출력이 contract에 맞는지 검증한다.
  const output = OUT.safeParse({
    as_of_seq: got.value.as_of_seq,
    next_cursor: summary.next_cursor,
    summary,
  });
  assertEquals(output.success, true);
  // open·fixing 문제가 둘 다 있다.
  assertEquals(summary.problems.map((one) => one.status).sort(), [
    "fixing",
    "open",
  ]);
  // open·check_failed ticket이 둘 다 있다.
  assertEquals(summary.tickets.map((one) => one.state).sort(), [
    "check_failed",
    "open",
  ]);
  // 요약에는 본문·log·첨부·묶음이 없다: what·why 같은 본문 field가 tickets에 없다.
  assertEquals(
    summary.tickets.some((one) => "what" in one || "why" in one),
    false,
  );
});

Deno.test("coding-agent/guides#R21: 요약의 각 항목에서 상세 조회가 가능하고 앱 하나 범위 연결이 다른 앱을 물으면 없는 앱과 같은 답이다", async () => {
  const s = scriptedClient({
    ...baseHandlers(),
    // getProblem·ticketShow 상세 읽기도 부른다. 상세 조회 통로가 있다는 확인이다.
    [getProblem.name]: (input) => {
      const id = (input as { problem: string }).problem;
      return ok({
        ...meta,
        ...problemDetail("ready_to_hand_off", {
          problem: {
            id,
            app: APP,
            status: "open",
            work: null,
            group_key: {
              kind: "declared",
              code: "my_code",
              discriminator: null,
            },
            interpretation: null,
            closure: null,
            seq: "10",
          },
        }),
      });
    },
  });
  const got = await run(s.client);
  assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
  // 상세 읽기(getProblem·ticketShow)가 항목마다 불렸다. list는 open·fixing 상태별
  // 읽기라 같은 문제가 두 번 나오고, ticket도 open·check_failed·claimed 세 번
  // 나온다(base handler가 state를 가르지 않는다).
  assertEquals(s.sent.filter((one) => one.name === "GetProblem").length, 2);
  assertEquals(s.sent.filter((one) => one.name === "ShowTicket").length, 3);
  // 부른 읽기는 읽기뿐이다. claim 생성·갱신·수리 착수 command가 없다.
  assertEquals(
    s.sent.every((one) =>
      [
        "ShowCodingAgentConnection",
        "ListProblems",
        "GetProblem",
        "ListTickets",
        "ShowTicket",
        "TicketChecks",
      ].includes(one.name)
    ),
    true,
  );
  // 앱 하나 범위 연결이 다른 앱을 물면 없는 앱과 같은 not_found다.
  const other = await run(s.client, { app: "app_01h455vb4pex5v6nkc6gd5fdw9" });
  assert(!other.ok);
  assertEquals(other.error.code, "not_found");
  const absent = await run(s.client, { app: "app_01h455vb4pex5v6nkc6gd5fb0" });
  assertEquals(other.error.code, absent.ok ? "" : absent.error.code);
  assertEquals(other.error.message, absent.ok ? "" : absent.error.message);
});

Deno.test("coding-agent/guides#R21: 범위 밖 자료는 요약에 없다. connection 둘의 claim 중 내 것만 들어가고 다른 연결의 claim은 빠진다", async () => {
  const CAC2 = "cac_01h455vb4pex5v6nkc6gd5fdw9";
  const s = scriptedClient({
    ...baseHandlers(),
    [ticketList.name]: (input) => {
      const state = (input as { state?: string }).state;
      if (state === "claimed") {
        return ok({
          ...meta,
          tickets: [
            ticketRow({ state: "claimed" }),
            ticketRow({ id: TKT2, state: "claimed" }),
          ],
        });
      }
      return ok({ ...meta, tickets: [] });
    },
    [ticketShow.name]: (input) => {
      const id = (input as { ticket: string }).ticket;
      // TKT는 내 연결 claim, TKT2는 다른 연결 claim이다.
      return ok({
        ...meta,
        ...ticketShown({
          id,
          state: "claimed",
          claim: {
            connection: id === TKT ? CAC : CAC2,
            claim_seq: "9",
            expires_at: AT,
          },
        }),
      });
    },
  });
  const got = await run(s.client);
  assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
  assertEquals(got.value.summary.claims.length, 1);
  assertEquals(got.value.summary.claims[0].ticket, TKT);
  assertEquals(got.value.summary.claims[0].connection, CAC);
  assertEquals(got.value.summary.claims[0].expires_at, AT);
});

Deno.test("coding-agent/guides#R21: 남은 검사 조건은 pass가 아닌 조건 번호와 이유다. 검사가 없으면 조건 전체다", async () => {
  const s = scriptedClient({
    ...baseHandlers(),
    [ticketList.name]: (input) => {
      const state = (input as { state?: string }).state;
      if (state === "reported") {
        return ok({
          ...meta,
          tickets: [
            ticketRow({ id: TKT, state: "reported" }),
            ticketRow({ id: TKT2, state: "reported" }),
          ],
        });
      }
      return ok({ ...meta, tickets: [] });
    },
    [ticketShow.name]: (input) => {
      const id = (input as { ticket: string }).ticket;
      return ok({
        ...meta,
        ...ticketShown({
          id,
          state: "reported",
          conditions: [
            {
              position: 0,
              kind: "test_command",
              input: {
                kind: "test_command",
                executable: "deno",
                argv: ["test"],
                cwd: ".",
                timeout_ms: 60_000,
                expected_exit_code: 0,
              },
              condition_hash: "a".repeat(64),
            },
            {
              position: 1,
              kind: "test_command",
              input: {
                kind: "test_command",
                executable: "deno",
                argv: ["lint"],
                cwd: ".",
                timeout_ms: 60_000,
                expected_exit_code: 0,
              },
              condition_hash: "b".repeat(64),
            },
          ],
        }),
      });
    },
    // TKT는 검사가 있고 둘째가 fail, TKT2는 검사가 없다(완료 보고는 있다).
    [ticketChecks.name]: (input) => {
      const id = (input as { ticket: string }).ticket;
      return id === TKT
        ? ok({
          ...meta,
          ticket: TKT,
          completion_seq: "12",
          checks: [
            {
              condition: 0,
              result: "pass",
              reason: "",
              verification: "vrf_01h455vb4pex5v6nkc6gd5fdw1",
            },
            {
              condition: 1,
              result: "fail",
              reason: "테스트가 실패했다",
              verification: null,
            },
          ],
        })
        : ok({
          ...meta,
          ticket: TKT2,
          completion_seq: "13",
          checks: [],
        });
    },
  });
  const got = await run(s.client);
  assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
  assertEquals(got.value.summary.remaining_checks.length, 2);
  const first = got.value.summary.remaining_checks[0];
  assertEquals(first.ticket, TKT);
  assertEquals(first.completion_seq, "12");
  assertEquals(first.conditions, [1]);
  assertEquals(first.reason, "테스트가 실패했다");
  const second = got.value.summary.remaining_checks[1];
  assertEquals(second.ticket, TKT2);
  // 검사 전이면 조건 전체다.
  assertEquals(second.conditions, [0, 1]);
});

Deno.test("coding-agent/guides#R22: summary 읽기는 claim 생성·갱신·수리 착수 command를 부르지 않는다. 읽기 전용 route만 닿는다", async () => {
  const s = scriptedClient(baseHandlers());
  const got = await run(s.client);
  assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
  assertEquals(
    s.sent.every((one) =>
      [
        "ShowCodingAgentConnection",
        "ListProblems",
        "GetProblem",
        "ListTickets",
        "ShowTicket",
        "TicketChecks",
      ].includes(one.name)
    ),
    true,
  );
  // 착수 지시가 아니라는 안내가 들어 있다(R22).
  assert(got.value.summary.claim_rule === CLAIM_RULE);
  assert(CLAIM_RULE.includes("착수 지시가 아니다"));
  assert(CLAIM_RULE.includes("[Start]"));
});

Deno.test("coding-agent/guides#R21: cursor는 위치만 담고 paging을 이어 내린다. 전체를 다 읽으면 next_cursor는 null이다", async () => {
  // 접미가 ULID 문자셋 안의 3자다(26자 ulid의 뒤 3자). i·l·o·u를 쓰지 않는다.
  const suffixes = [
    "fdw1",
    "fdw2",
    "fdw3",
    "fdw4",
    "fdw5",
    "fdw6",
    "fdw7",
    "fdw8",
    "fdw9",
    "fdwa",
    "fdwb",
    "fdwc",
    "fdwd",
    "fdwe",
    "fdwf",
    "fdwg",
    "fdwh",
    "fdwj",
    "fdwk",
    "fdwm",
    "fdwn",
    "fdwp",
    "fdwq",
    "fdwr",
    "fdws",
    "fdwt",
    "fdwv",
    "fdww",
    "fdwx",
    "fdwy",
  ];
  const manyProblems = Array.from({ length: 30 }, (_, i) =>
    problemSummary({
      id: `prb_01h455vb4pex5v6nkc6gd5${suffixes[i]}`,
      seq: String(i + 1),
    }));
  const s = scriptedClient({
    ...baseHandlers(),
    [listProblems.name]: (input) => {
      const page = Number((input as { cursor?: string }).cursor ?? "0");
      const slice = manyProblems.slice(page, page + 20);
      return ok({
        ...(slice.length < 20
          ? meta
          : { as_of_seq: "40", next_cursor: String(page + 20) }),
        problems: slice,
      });
    },
  });
  const got = await run(s.client);
  assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
  assertEquals(got.value.summary.problems.length, 12);
  // next_cursor가 있으면 이어 읽는다.
  assert(got.value.summary.next_cursor !== null);
  const next = await run(s.client, {
    cursor: got.value.summary.next_cursor ?? undefined,
  });
  assert(next.ok, next.ok ? "" : JSON.stringify(next.error));
  assertEquals(next.value.summary.problems.length, 12);
  // cursor를 조작하면 invalid_input이다.
  const bad = await run(s.client, { cursor: "p1.t2.app_x" });
  assert(!bad.ok);
  assertEquals(bad.error.code, "invalid_input");
});

Deno.test("coding-agent/guides#R21: 읽기 실패를 빈 목록으로 바꾸지 않는다. 그 오류를 그대로 돌려준다", async () => {
  const s = scriptedClient({
    ...baseHandlers(),
    [listProblems.name]: () =>
      err({ code: "unavailable", message: "core가 닫혔다" }),
  });
  const got = await run(s.client);
  assert(!got.ok);
  assertEquals(got.error.code, "unavailable");
  assertEquals(got.error.message, "core가 닫혔다");

  const s2 = scriptedClient({
    ...baseHandlers(),
    [ticketShow.name]: () => err({ code: "not_found", message: "없다" }),
  });
  const got2 = await run(s2.client);
  assert(!got2.ok);
  assertEquals(got2.error.code, "not_found");
});

Deno.test("coding-agent/guides#R22: principal이 coding_agent 주체가 아니면 unauthorized다. 사람 principal은 summary를 읽지 않는다", async () => {
  const s = scriptedClient(baseHandlers());
  const got = await assembleSessionSummary(s.client, {
    principal: "user:u_01",
    input: {},
    now: () => AT,
  });
  assert(!got.ok);
  assertEquals(got.error.code, "unauthorized");
});
