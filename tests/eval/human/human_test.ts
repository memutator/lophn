// 두 질문
// - contract: 사람 역할은 시나리오 허락 규칙 밖의 일을 허락하지 않고, 같은 request를 두 번 결정하지 않는다.
//   질문은 대기 entry가 되고, 답이 오면 모든 질문에 순서대로 질문 글 그대로의 답이 askAnswer로 간다(askAnswer는 question이 글자 그대로 같아야 받는다).
// - 현실적 회귀: 규칙 없는 permission이 허락되어 시나리오가 모르는 grant가 생기는 것. 어긋난 답으로 ask가 invalid_input이 되어 trial이 상한까지 멈추는 것.
// - 왜 지금 test로 못 잡나: core 없이 도는 pure test다. 가짜 tryCall과 임시 폴더만 쓴다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { manualClock } from "../../../packages/base/mod.ts";
import type { AskQuestion } from "../../../packages/protocol/lophn-agent/ask-tool.ts";
import type { ApproveRule } from "../types.ts";
import {
  ANSWER_DEFAULT,
  buildAnswers,
  createHumanRole,
  type HumanPort,
  readQuestions,
  renderForAgent,
  writeGivenAnswer,
  writeQuestion,
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

function fakePort(
  extra: { questions?: boolean; answerError?: string } = {},
) {
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
      if (key === "ask/answer" && extra.answerError) {
        return Promise.resolve({
          ok: false,
          error: { code: extra.answerError, message: "no" },
        } as never);
      }
      return Promise.resolve({ ok: true, value } as never);
    },
  };
  return { port, calls };
}

const deps = (dir: string, logs: string[] = []) => ({
  clock: manualClock(0),
  evalDir: dir,
  run: "r1",
  trial: 0,
  log: (line: string) => logs.push(line),
});

async function run(approve: ApproveRule) {
  const { port, calls } = fakePort();
  const dir = await Deno.makeTempDir();
  const role = createHumanRole({
    ...deps(dir),
    port,
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

const DEFAULT = ANSWER_DEFAULT;

Deno.test("buildAnswers copies question text, fills default and keeps one value for single select", () => {
  const cases: [(string[] | undefined)[], string[][]][] = [
    [[["Week"], ["Export", "Share"]], [["Week"], ["Export", "Share"]]],
    [[["Week", "Month"], [" "]], [["Week"], [DEFAULT]]],
    [[["Week"]], [["Week"], [DEFAULT]]],
    [[], [[DEFAULT], [DEFAULT]]],
  ];
  for (const [selected, answers] of cases) {
    const out = buildAnswers(QUESTIONS, selected);
    assertEquals(out.map((a) => a.question), QUESTIONS.map((q) => q.question));
    assertEquals(out.map((a) => a.answer), answers);
    assert(out.every((a) => a.status === "answered"));
  }
});

Deno.test("human question becomes a pending entry, goes to askAnswer only when answered, and a rejected answer can be given again", async () => {
  const dir = await Deno.makeTempDir();
  const logs: string[] = [];
  const { port, calls } = fakePort({ questions: true });
  const role = createHumanRole({
    ...deps(dir, logs),
    port,
    spec: { card: "CARD TEXT", approve: {} },
  });
  const sends = () => calls.filter((c) => c.key === "ask/answer");

  // 답이 없는 동안은 대기 entry만 있고 아무것도 보내지 않는다. entry는 한 번만 쓴다.
  await role.tick();
  await role.tick();
  assertEquals(sends().length, 0);
  assertEquals(role.waiting(), ["t0-tcl_a"]);
  assertEquals(logs, ["답 대기 r1 t0-tcl_a"]);
  const [{ question: entry, answered }] = await readQuestions(dir, "r1");
  assertEquals(answered, false);
  assertEquals(entry.card, "CARD TEXT");
  assertEquals(entry.earlier, []);
  assertEquals(entry.questions, QUESTIONS);
  const text = renderForAgent({ n: 1, prompt: "PROMPT" }, entry);
  assert(text.includes("<requirement_card>\nCARD TEXT\n"));
  assert(text.includes("<earlier_answers>\n(none)\n"));
  assert(!text.includes("ses_a") && !text.includes("tcl_a"));
  await assertRejects(() => writeQuestion(dir, entry));

  // 답이 오면 질문 글 그대로 순서대로 간다. 보내는 것이 거절되면 답 file을 지워 다시 답하게 한다.
  const given = { model: "m", answered_at: "t", selected: [["Week", "Month"]] };
  const dir2 = await Deno.makeTempDir();
  const rejecting = fakePort({ questions: true, answerError: "invalid_input" });
  const role2 = createHumanRole({
    ...deps(dir2, logs),
    port: rejecting.port,
    spec: { card: "CARD TEXT", approve: {} },
  });
  await role2.tick();
  await writeGivenAnswer(dir2, "r1", entry.key, given);
  await role2.tick();
  assertEquals(
    (rejecting.calls.find((c) => c.key === "ask/answer")?.input
      .answers as { question: string; answer: string[] }[]).map((a) => [
        a.question,
        a.answer,
      ]),
    [["Which view first?", ["Week"]], ["Which extras?", [DEFAULT]]],
  );
  assertEquals(role2.record().answers[0].error, "invalid_input: no");
  assert(logs.some((l) => l.startsWith("답 거절 r1 t0-tcl_a")));
  assertEquals((await readQuestions(dir2, "r1"))[0].answered, false);
  await role2.tick();
  assertEquals(rejecting.calls.filter((c) => c.key === "ask/answer").length, 1);

  // 정상 길: 보낸 뒤 완료로 치고 다시 보내지 않으며 앞선 답이 다음 질문 entry에 실린다.
  await writeGivenAnswer(dir, "r1", entry.key, given);
  await role.tick();
  await role.tick();
  assertEquals(sends().length, 1);
  assertEquals(role.waiting(), []);
  const rec = role.record();
  assertEquals(rec.answers[0].model, "m");
  assertEquals(rec.answers[0].error, null);
});
