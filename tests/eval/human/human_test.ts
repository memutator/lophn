// 두 질문
// - contract: 사람 역할은 시나리오 허락 규칙 밖의 일을 허락하지 않고, 같은 request를 두 번 결정하지 않는다.
//   질문은 대기 entry가 되고, 답이 오면 모든 질문에 순서대로 질문 글 그대로의 답이 askAnswer로 간다(askAnswer는 question이 글자 그대로 같아야 받는다).
// - 현실적 회귀: 규칙 없는 동의나 turn request가 허락되어 시나리오가 모르는 허락이 생기는 것. 어긋난 답으로 ask가 invalid_input이 되어 trial이 상한까지 멈추는 것.
// - 왜 지금 test로 못 잡나: core 없이 도는 pure test다. 가짜 tryCall과 임시 폴더만 쓴다.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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

type Call = {
  key: string;
  input: Record<string, unknown>;
  compare: unknown;
};

const REQUESTED_AT = "2026-01-01T00:00:00.000Z";
const ULID = "0".repeat(26);

function fakePort(
  extra: {
    questions?: boolean;
    answerError?: string;
    alwaysPatterns?: string[];
  } = {},
) {
  const calls: Call[] = [];
  const port: HumanPort = {
    tryCall: (route, input, compare) => {
      const key = `${route.resource}/${route.method}`;
      calls.push({ key, input: input as Record<string, unknown>, compare });
      let value: unknown = {};
      if (key === "session_snapshots/list") {
        value = {
          snapshots: [
            {
              session: "ses_a",
              questions: extra.questions
                ? [{ group: "qgr_a", turn: "trn_a", tool_call: "tcl_a" }]
                : [],
              turn_requests: [
                {
                  id: `apr_${ULID}`,
                  session: "ses_a",
                  turn: `trn_${ULID}`,
                  tool_call: `tcl_${ULID}`,
                  subject: { kind: "shell", command: "rm -r build" },
                  always_patterns: extra.alwaysPatterns ?? ["rm -r *"],
                  created_at: REQUESTED_AT,
                },
                {
                  id: `apr_${ULID.slice(0, 25)}1`,
                  session: "ses_a",
                  turn: `trn_${ULID}`,
                  tool_call: `tcl_${ULID.slice(0, 25)}1`,
                  subject: {
                    kind: "app_tool",
                    app: `app_${ULID}`,
                    tool: "calendar.list",
                    effect: "read",
                  },
                  always_patterns: [],
                  created_at: REQUESTED_AT,
                },
              ],
            },
          ],
        };
      } else if (key === "activations/consents") {
        value = {
          consents: [
            {
              app: `app_${ULID}`,
              release: `rel_${ULID}`,
              comparison: {
                previous_release: null,
                first: true,
                added_resources: [],
                added_tools: [],
                loss_steps: [],
              },
              requested_at: REQUESTED_AT,
            },
          ],
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

async function run(approve: ApproveRule, alwaysPatterns?: string[]) {
  const { port, calls } = fakePort({ alwaysPatterns });
  const dir = await mkdtemp(join(tmpdir(), "lophn-eval-"));
  const role = createHumanRole({
    ...deps(dir),
    port,
    spec: { card: "card", approve },
  });
  await role.tick();
  await role.tick();
  return calls;
}

test("human role allows only what the scenario rule says and answers each request once", async () => {
  const shellId = `apr_${ULID}`;
  const toolId = `apr_${ULID.slice(0, 25)}1`;
  const cases: {
    approve: ApproveRule;
    patterns?: string[];
    consent: "allow" | "reject";
    shell: string;
  }[] = [
    {
      approve: { activation: "allow", shell: "once" },
      consent: "allow",
      shell: "once",
    },
    { approve: {}, consent: "reject", shell: "reject" },
    {
      approve: { shell: "always" },
      patterns: [],
      consent: "reject",
      shell: "reject",
    },
  ];
  for (const c of cases) {
    const calls = await run(c.approve, c.patterns);
    const consents = calls.filter((x) => x.key === "activations/consent");
    assert.deepStrictEqual(consents.length, 1);
    assert.deepStrictEqual(consents[0].input, {
      release: `rel_${ULID}`,
      choice: c.consent,
    });
    assert.deepStrictEqual(consents[0].compare, { requested_at: REQUESTED_AT });
    const decides = calls.filter((x) => x.key === "turn_requests/decide");
    assert.deepStrictEqual(decides.length, 2);
    const kindOf = (id: string) =>
      (
        decides.find((x) => x.input.request === id)?.input.choice as {
          kind: string;
        }
      ).kind;
    assert.deepStrictEqual(kindOf(shellId), c.shell);
    assert.deepStrictEqual(kindOf(toolId), "reject");
  }
});

const DEFAULT = ANSWER_DEFAULT;

test("buildAnswers copies question text, fills default and keeps one value for single select", () => {
  const cases: [(string[] | undefined)[], string[][]][] = [
    [
      [["Week"], ["Export", "Share"]],
      [["Week"], ["Export", "Share"]],
    ],
    [
      [["Week", "Month"], [" "]],
      [["Week"], [DEFAULT]],
    ],
    [[["Week"]], [["Week"], [DEFAULT]]],
    [[], [[DEFAULT], [DEFAULT]]],
  ];
  for (const [selected, answers] of cases) {
    const out = buildAnswers(QUESTIONS, selected);
    assert.deepStrictEqual(
      out.map((a) => a.question),
      QUESTIONS.map((q) => q.question),
    );
    assert.deepStrictEqual(
      out.map((a) => a.answer),
      answers,
    );
    assert.ok(out.every((a) => a.status === "answered"));
  }
});

test("human question becomes a pending entry, goes to askAnswer only when answered, and a rejected answer can be given again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-eval-"));
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
  assert.deepStrictEqual(sends().length, 0);
  assert.deepStrictEqual(role.waiting(), ["t0-tcl_a"]);
  assert.deepStrictEqual(logs, ["답 대기 r1 t0-tcl_a"]);
  const [{ question: entry, answered }] = await readQuestions(dir, "r1");
  assert.deepStrictEqual(answered, false);
  assert.deepStrictEqual(entry.card, "CARD TEXT");
  assert.deepStrictEqual(entry.earlier, []);
  assert.deepStrictEqual(entry.questions, QUESTIONS);
  const text = renderForAgent({ n: 1, prompt: "PROMPT" }, entry);
  assert.ok(text.includes("<requirement_card>\nCARD TEXT\n"));
  assert.ok(text.includes("<earlier_answers>\n(none)\n"));
  assert.ok(!text.includes("ses_a") && !text.includes("tcl_a"));
  await assert.rejects(() => writeQuestion(dir, entry));

  // 답이 오면 질문 글 그대로 순서대로 간다. 보내는 것이 거절되면 답 file을 지워 다시 답하게 한다.
  const given = { model: "m", answered_at: "t", selected: [["Week", "Month"]] };
  const dir2 = await mkdtemp(join(tmpdir(), "lophn-eval-"));
  const rejecting = fakePort({ questions: true, answerError: "invalid_input" });
  const role2 = createHumanRole({
    ...deps(dir2, logs),
    port: rejecting.port,
    spec: { card: "CARD TEXT", approve: {} },
  });
  await role2.tick();
  await writeGivenAnswer(dir2, "r1", entry.key, given);
  await role2.tick();
  assert.deepStrictEqual(
    (
      rejecting.calls.find((c) => c.key === "ask/answer")?.input.answers as {
        question: string;
        answer: string[];
      }[]
    ).map((a) => [a.question, a.answer]),
    [
      ["Which view first?", ["Week"]],
      ["Which extras?", [DEFAULT]],
    ],
  );
  assert.deepStrictEqual(role2.record().answers[0].error, "invalid_input: no");
  assert.ok(logs.some((l) => l.startsWith("답 거절 r1 t0-tcl_a")));
  assert.deepStrictEqual((await readQuestions(dir2, "r1"))[0].answered, false);
  await role2.tick();
  assert.deepStrictEqual(
    rejecting.calls.filter((c) => c.key === "ask/answer").length,
    1,
  );

  // 정상 길: 보낸 뒤 완료로 치고 다시 보내지 않으며 앞선 답이 다음 질문 entry에 실린다.
  await writeGivenAnswer(dir, "r1", entry.key, given);
  await role.tick();
  await role.tick();
  assert.deepStrictEqual(sends().length, 1);
  assert.deepStrictEqual(role.waiting(), []);
  const rec = role.record();
  assert.deepStrictEqual(rec.answers[0].model, "m");
  assert.deepStrictEqual(rec.answers[0].error, null);
});
