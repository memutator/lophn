// roles/lophn#R18: 운영 보고는 앱 상태(app.runtime)·열린 문제·진행 ticket의 확인된
// 사실을 먼저 싣고, 근거 주소가 있는 해석을 최대 5줄로 구분하며, 미확인 수치는
// "확인하지 못함"으로 적는다(가짜 health 없음). model provider와 실제 core는 부르지
// 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  type AppFact,
  buildOpsReport,
  confirmed,
  type Interpretation,
  OPS_INTERPRETATION_LIMIT,
  opsReportBody,
  type ProblemFact,
  type TicketFact,
  UNKNOWN_WORD,
  unknownLine,
} from "./mod.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const APP2 = "app_01arz3ndektsv4rrffq69g5faw";
const PROBLEM = "prb_01arz3ndektsv4rrffq69g5fav";
const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";

Deno.test("lophn-agent/roles/lophn#R18: 운영 보고는 앱 상태·열린 문제·진행 ticket의 확인된 사실을 먼저 싣는다", () => {
  const apps: AppFact[] = [
    { app: APP, state: "running", running: true },
    { app: APP2, state: "unavailable", running: false },
  ];
  const problems: ProblemFact[] = [{
    problem: PROBLEM,
    app: APP,
    status: "open",
    symptom: "the count is off by one",
  }];
  const tickets: TicketFact[] = [{
    ticket: TICKET,
    app: APP,
    state: "claimed",
    in_progress: true,
  }];
  const report = buildOpsReport({
    apps,
    problems,
    tickets,
    interpretations: [{
      basis: "app.runtime:running",
      line: "the app is up, so the count reads are live.",
    }],
    unknown: [],
  });
  // 사실이 먼저고 해석은 뒤다(R18).
  assertEquals(report.facts.apps, apps);
  assertEquals(report.facts.problems, problems);
  assertEquals(report.facts.tickets, tickets);
  assertEquals(report.interpretations, [{
    basis: "app.runtime:running",
    line: "the app is up, so the count reads are live.",
  }]);
  const body = opsReportBody(report);
  assert(body.indexOf("## Facts") < body.indexOf("## Interpretations"));
  assert(body.includes(`- app ${APP}: running, running`));
  assert(
    body.includes(
      `- problem ${PROBLEM} of ${APP}: open (the count is off by one)`,
    ),
  );
  assert(body.includes(`- ticket ${TICKET} of ${APP}: claimed`));
  assert(body.includes("(app.runtime:running)"));
});

Deno.test("lophn-agent/roles/lophn#R18: 근거 주소가 있는 해석은 최대 5줄이다", () => {
  assertEquals(OPS_INTERPRETATION_LIMIT, 5);
  const many: Interpretation[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    basis: `app.runtime:${n}`,
    line: `interpretation ${n}.`,
  }));
  const report = buildOpsReport({
    apps: [],
    problems: [],
    tickets: [],
    interpretations: many,
    unknown: [],
  });
  // 6줄째부터는 버린다(R18: 해석을 6줄 이상 쓰지 않는다).
  assertEquals(report.interpretations.length, 5);
  assertEquals(
    report.interpretations.map((entry) => entry.basis),
    [1, 2, 3, 4, 5].map((n) => `app.runtime:${n}`),
  );
  // 근거 주소가 없는 해석은 버린다(R18: 근거 주소가 있는 해석만 구분한다).
  const noBasis = buildOpsReport({
    apps: [],
    problems: [],
    tickets: [],
    interpretations: [
      { basis: "  ", line: "a guess without basis." },
      { basis: "app.runtime:ready", line: "  " },
      {
        basis: "app.runtime:ready",
        line: "the app answers, so reads are live.",
      },
    ],
    unknown: [],
  });
  assertEquals(noBasis.interpretations, [{
    basis: "app.runtime:ready",
    line: "the app answers, so reads are live.",
  }]);
});

Deno.test("lophn-agent/roles/lophn#R18: 미확인 수치는 확인하지 못함으로 적고 가짜 health를 만들지 않는다", () => {
  // state·running을 읽지 못한 앱은 확인된 사실이 아니다(R18).
  const unreadable: AppFact = { app: APP, state: null, running: null };
  assertEquals(confirmed(unreadable), false);
  const report = buildOpsReport({
    apps: [unreadable, { app: APP2, state: "running", running: true }],
    problems: [],
    tickets: [],
    interpretations: [],
    unknown: ["invocation count for the hour"],
  });
  // 미확인 항목은 확인하지 못함이다(R18). 값을 만들지 않는다.
  assert(report.unknown.includes("invocation count for the hour"));
  const body = opsReportBody(report);
  assert(body.includes(unknownLine(`app ${APP}`)));
  assert(body.includes(UNKNOWN_WORD));
  assert(body.includes("invocation count for the hour: 확인하지 못함"));
  // 읽은 앱은 사실대로 남는다.
  assert(body.includes(`- app ${APP2}: running, running`));
  // 확인되지 않은 앱의 state를 만들어 넣지 않는다.
  assertFalse(body.includes(`- app ${APP}: running`));
  assertFalse(body.includes(`- app ${APP}: stopped`));
  // 가능한 state 값을 나열해도 미확인 앱에는 붙지 않는다(R18: 자료 없는 수치를
  // 만들어 넣지 않는다).
  for (const state of ["preparing", "stopped", "running", "unavailable"]) {
    assertFalse(body.includes(`- app ${APP}: ${state}`));
  }
});
