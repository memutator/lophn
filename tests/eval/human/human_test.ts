// 두 질문
// - contract: 사람 역할은 시나리오 허락 규칙 밖의 일을 허락하지 않고, 같은 request를 두 번 결정하지 않는다.
//   모델이 틀리거나 실패해도 모든 질문에 순서대로 답이 가고(askAnswer는 question이 글자 그대로 같아야 받는다), 모델은 카드와 질문만 본다.
// - 현실적 회귀: 규칙 없는 permission이 허락되어 시나리오가 모르는 grant가 생기는 것. 어긋난 답으로 ask가 invalid_input이 되어 trial이 상한까지 멈추는 것.
// - 왜 지금 test로 못 잡나: core 없이 도는 pure test이고 진짜 API를 부르지 않는다. 가짜 tryCall과 가짜 fetch만 쓴다.
import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../../packages/base/mod.ts";
import type { AskQuestion } from "../../../packages/protocol/lophn-agent/ask-tool.ts";
import type { ApproveRule } from "../types.ts";
import {
  answerQuestions,
  createHumanRole,
  type HumanPort,
  loadHumanDefinition,
} from "./mod.ts";

const QUESTIONS: AskQuestion[] = [
  {
    question: "Which view first?",
    header: "View",
    options: [
      { label: "Month", description: "Monthly grid" },
      { label: "Week", description: "Weekly list" },
    ],
    multiSelect: false,
  },
  {
    question: "Which extras?",
    header: "Extras",
    options: [
      { label: "Export", description: "CSV export" },
      { label: "Share", description: "Share link" },
    ],
    multiSelect: true,
  },
];

type Call = { key: string; input: Record<string, unknown> };

function fakePort(extra: { questions?: boolean } = {}) {
  const calls: Call[] = [];
  const port: HumanPort = {
    tryCall: (route, input) => {
      const key = `${route.resource}/${route.method}`;
      calls.push({ key, input: input as Record<string, unknown> });
      let value: unknown = {};
      if (key === "session_snapshots/list") {
        value = {
          snapshots: [{
            session: "ses_a",
            questions: extra.questions
              ? [{ group: "qgr_a", turn: "trn_a", tool_call: "tcl_a" }]
              : [],
            permission_requests: [{
              id: "apr_turn",
              session: "ses_a",
              intent: { kind: "app_api", target: { kind: "app_api" } },
              choices: ["once", "session", "always", "reject"],
            }],
          }],
        };
      } else if (key === "approvals/pending") {
        value = {
          requests: [{
            id: "apr_pend",
            intent: { kind: "activation", target: { kind: "activation" } },
            choices: ["allow", "reject"],
          }],
        };
      } else if (key === "ask/read") {
        value = { group: "qgr_a", questions: QUESTIONS };
      }
      return Promise.resolve({ ok: true, value } as never);
    },
  };
  return { port, calls };
}

const noFetch = () => Promise.reject(new Error("no fetch expected"));

async function run(approve: ApproveRule) {
  const { port, calls } = fakePort();
  const role = createHumanRole({
    port,
    fetch: noFetch,
    apiKey: "k",
    clock: manualClock(0),
    spec: { card: "card", approve },
  });
  await role.tick();
  await role.tick();
  return { calls, role };
}

Deno.test("human role decides only by the scenario rule and once per request", async () => {
  const none = await run({ activation: "allow" });
  const turn = none.calls.filter((c) => c.key === "approvals/decide_turn");
  const pend = none.calls.filter((c) => c.key === "approvals/decide");
  assertEquals(turn.length, 1);
  assertEquals((turn[0].input.choice as { kind: string }).kind, "reject");
  assertEquals(pend.length, 1);
  assertEquals(pend[0].input.choice, { kind: "allow" });
  assertEquals(none.role.record().decisions.map((d) => d.rule), [
    null,
    "allow",
  ]);

  const session = await run({ app_api: "session" });
  const sessionTurn = session.calls.find((c) =>
    c.key === "approvals/decide_turn"
  );
  assertEquals(sessionTurn?.input.choice, { kind: "session" });
  const sessionPend = session.calls.find((c) => c.key === "approvals/decide");
  assertEquals((sessionPend?.input.choice as { kind: string }).kind, "reject");

  // 규칙 값이 선택지에 없으면 만들어 내지 않고 거절한다. allow만 once로 좁힌다.
  const narrowed = await run({ app_api: "allow", activation: "once" });
  assertEquals(
    narrowed.calls.find((c) => c.key === "approvals/decide_turn")?.input.choice,
    { kind: "once" },
  );
  assertEquals(
    (narrowed.calls.find((c) => c.key === "approvals/decide")?.input
      .choice as { kind: string }).kind,
    "reject",
  );
});

const reply = (content: unknown[], status = 200) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        content,
        stop_reason: "end_turn",
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      }),
      { status },
    ),
  );
const answerBlock = (answers: unknown) => ({
  type: "tool_use",
  name: "answer",
  input: { answers },
});
const DEFAULT = "추천대로 해 줘";

Deno.test("human answers every question in order, records failures and shows the model only the card and questions", async () => {
  const definition = await loadHumanDefinition();
  const fails = [
    {
      name: "ok",
      res: () =>
        reply([
          answerBlock([{ selected: ["Week"] }, {
            selected: ["Export", "Share"],
          }]),
        ]),
      error: null,
      answers: [["Week"], ["Export", "Share"]],
    },
    {
      name: "single select keeps one",
      res: () =>
        reply([
          answerBlock([{ selected: ["Week", "Month"] }, { selected: [" "] }]),
        ]),
      error: null,
      answers: [["Week"], [DEFAULT]],
    },
    {
      name: "short",
      res: () => reply([answerBlock([{ selected: ["Week"] }])]),
      error: "answers length 1 != 2",
      answers: [["Week"], [DEFAULT]],
    },
    {
      name: "http",
      res: () => reply([], 500),
      error: "http 500",
      answers: [[DEFAULT], [DEFAULT]],
    },
    {
      name: "no tool",
      res: () => reply([{ type: "text", text: "Week" }]),
      error: "no answer (stop_reason=end_turn)",
      answers: [[DEFAULT], [DEFAULT]],
    },
    {
      name: "network",
      res: () => Promise.reject(new Error("boom")),
      error: "network: boom",
      answers: [[DEFAULT], [DEFAULT]],
    },
  ];
  for (const f of fails) {
    const out = await answerQuestions(
      { fetch: f.res, apiKey: "k", definition },
      { card: "CARD TEXT", earlier: [], questions: QUESTIONS },
    );
    assertEquals(out.error, f.error, f.name);
    assertEquals(
      out.answers.map((a) => a.question),
      QUESTIONS.map((q) => q.question),
      f.name,
    );
    assertEquals(out.answers.map((a) => a.answer), f.answers, f.name);
    assert(out.answers.every((a) => a.status === "answered"), f.name);
  }

  let sentBody = "";
  await answerQuestions({
    fetch: (_u, init) => {
      sentBody = init.body as string;
      return reply([]);
    },
    apiKey: "k",
    definition,
  }, {
    card: "CARD TEXT",
    earlier: [{ question: "Q before?", answer: ["A before", "B"] }],
    questions: QUESTIONS,
  });
  assert(sentBody.includes("Q: Q before?\\nA: A before, B"));

  // role: 읽은 질문 글 그대로 askAnswer에 가고, 요청에는 카드와 질문만 실리고 session id는 없다. 다룬 질문은 다시 부르지 않는다.
  const { port, calls } = fakePort({ questions: true });
  const bodies: string[] = [];
  const role = createHumanRole({
    port,
    fetch: (_url, init) => {
      bodies.push(init.body as string);
      return reply([]);
    },
    apiKey: "k",
    clock: manualClock(0),
    spec: { card: "CARD TEXT", approve: {} },
    definition,
  });
  await role.tick();
  const sent = calls.find((c) => c.key === "ask/answer");
  assertEquals(
    (sent?.input.answers as { question: string }[]).map((a) => a.question),
    QUESTIONS.map((q) => q.question),
  );
  const rec = role.record();
  assertEquals(rec.answers[0].error, "no answer (stop_reason=end_turn)");
  assertEquals(rec.cost_usd, 0.6);
  assert(bodies[0].includes("CARD TEXT"));
  assert(bodies[0].includes("(none)"));
  assert(!bodies[0].includes("ses_a") && !bodies[0].includes("tcl_a"));
  await role.tick();
  assertEquals(bodies.length, 1);
});
