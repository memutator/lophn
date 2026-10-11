import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../packages/base/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
} from "../../../packages/platform/redaction/mod.ts";
import type {
  AuthenticatedContext,
  RedactionInput,
  RedactionResult,
  SettingMutation,
  SqlParam,
  SqlRow,
} from "../../../packages/contracts/platform/mod.ts";
import { textContent } from "../../../packages/lophn-agent/conversation/testing/mod.ts";
import { createLedgerHarness, type LedgerHarness } from "./ledger.ts";
import { presetDefinitionJson } from "../../../packages/lophn-agent/harness/run-loop/testing/mod.ts";
import {
  agentRun,
  cred,
  hashOf,
  id,
  optionOf,
  sha256Text,
} from "../../../packages/lophn-agent/questions/testing/mod.ts";
import {
  screenAnswerText,
  SECURE_INPUT_GUIDANCE,
  settingsOptionAction,
} from "../../../packages/lophn-agent/questions/mod.ts";

// 질문 묶음 ledger 테스트(lophn-agent/questions). 실제 등록 executor(harness)와 임시 ledger
// 파일을 쓰고 시계는 등록(lophn-agent-questions-registration_test.ts)이 쥔다. agent 자격의
// command는 platform의 run 판정 port가 있어야 통과하므로(platform/ledger#R11) leaf 안
// 등록이 아니라 이 자리가 맡는다. 묶음 하나는 질문 1~4개이고 답·Skip·취소·만료가 묶음 전체에
// 한 번 걸린다. 단일 질문 시험은 묶음 하나에 질문 하나를 낸 경우로 옮겼다(질문 n은 묶음 n의
// 첫 질문이다). 실제 provider를 부르지 않고 사람 데이터 root를 열지 않는다.

const NOW = Date.UTC(2026, 0, 1);
const BASIS = "b".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };
const DONE = { kind: "completed", reason: "answer_completed" };

const userCred = cred("user");
const machineCred = cred("machine");
const ASG_LOPHN = id("asg", 1);
const ASG_CE = id("asg", 2);
const agentOf = (assignment: string) => cred(`agent:${assignment}`);
const RUN_1 = id("run", 1);
const RUN_2 = id("run", 2);
const RUN_4 = id("run", 4);
const RUN_5 = id("run", 5);
const SESSION = id("ses", 1);
const codingCred = cred(`coding_agent:${id("cac", 1)}`);
const appCred = cred(`app:${id("app", 1)}`);

// agent 자격은 run 하나에 묶여 발급된다. 시험은 그 run이 생긴 뒤 같은 모양의 자격을 쓴다.
const AGENT_RUNS: readonly [string, string][] = [
  [RUN_1, ASG_LOPHN],
  [RUN_2, ASG_CE],
  [RUN_4, ASG_LOPHN],
  [RUN_5, ASG_LOPHN],
];
const agentFor = (run: string): AuthenticatedContext => {
  const found = AGENT_RUNS.find(([candidate]) => candidate === run);
  assert(found !== undefined, "no agent credential for the run");
  return agentRun(found[1], run);
};

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

let counter = 0;
function env(
  command: string,
  input: unknown,
  compare: unknown = {},
  confirmation?: string,
) {
  counter++;
  return {
    command,
    input,
    compare,
    idempotency_key: `q-k-${counter}`,
    prepared: [] as string[],
    ...(confirmation === undefined ? {} : { confirmation }),
  };
}

async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL(
        "../../../packages/lophn-agent/harness/provider/registration_test.ts",
        import.meta.url,
      ),
      new URL(
        "../../../packages/lophn-agent/harness/usage/registration_test.ts",
        import.meta.url,
      ),
      new URL(
        "./lophn-agent-questions-registration_test.ts",
        import.meta.url,
      ),
      new URL(
        "../../../packages/platform/settings/harness-fixture_test.ts",
        import.meta.url,
      ),
    ],
    credentials: [
      userCred,
      machineCred,
      agentOf(ASG_LOPHN),
      agentOf(ASG_CE),
      ...AGENT_RUNS.map(([run, assignment]) => agentRun(assignment, run)),
      codingCred,
      appCred,
    ],
    nowMs: NOW,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return opened.value;
}

async function sql(
  h: LedgerHarness,
  query: string,
  params: readonly SqlParam[] = [],
): Promise<SqlRow[]> {
  return value(await h.inspect(query, params));
}

async function seedAssignments(h: LedgerHarness) {
  for (
    const [kind, assignment, n] of [
      ["lophn", ASG_LOPHN, 1],
      ["context_engineer", ASG_CE, 2],
    ] as const
  ) {
    const definition = presetDefinitionJson(kind);
    value(
      await h.command(
        machineCred,
        env("RegisterDefaultPreset", {
          id: id("pst", n),
          definition,
          definition_hash: hashOf(definition),
        }),
      ),
    );
    value(
      await h.command(
        machineCred,
        env("CreateBuiltinAssignment", {
          id: assignment,
          preset: id("pst", n),
          preset_revision: 1,
          role: kind,
          scope: { kind: "all", id: null },
        }),
      ),
    );
  }
}

async function runStateSeq(h: LedgerHarness, run: string): Promise<string> {
  const rows = await sql(
    h,
    "select cast(state_seq as text) as seq from runs where id = ?",
    [run],
  );
  return String(rows[0]!["seq"]);
}

let messageCounter = 0;
async function acceptRun(
  h: LedgerHarness,
  run: string,
  assignment: string,
  session: string | null = null,
) {
  messageCounter++;
  return value(
    await h.command(
      machineCred,
      env("AcceptRun", {
        id: run,
        assignment,
        session,
        source: { kind: "message", message: id("msg", messageCounter) },
        continued_from: null,
        start_after: null,
      }, { assignment_revision: 1 }),
    ),
  );
}

async function startRun(
  h: LedgerHarness,
  run: string,
  assignment: string,
  session: string | null = null,
) {
  await acceptRun(h, run, assignment, session);
  value(
    await h.command(
      machineCred,
      env("StartRun", {
        run,
        basis: BASIS,
        limits: LIMITS,
        scope: {
          role: assignment === ASG_LOPHN ? "lophn" : "context_engineer",
          assignment,
          apps: [],
        },
      }, { state_seq: await runStateSeq(h, run) }),
    ),
  );
}

async function finishRun(h: LedgerHarness, run: string) {
  value(
    await h.command(
      machineCred,
      env("FinishRun", { run, outcome: DONE, result: "c".repeat(64) }, {
        state_seq: await runStateSeq(h, run),
      }),
    ),
  );
}

// 준비된 ledger: assignment 둘과 시작한 run 둘(lophn·context engineer).
async function ready(): Promise<LedgerHarness> {
  const h = await open();
  await seedAssignments(h);
  await startRun(h, RUN_1, ASG_LOPHN);
  await startRun(h, RUN_2, ASG_CE);
  return h;
}

function option(key: string, extra: Record<string, unknown> = {}) {
  return { ...optionOf(key), ...extra };
}

function settingsAction(question: string, changes: unknown[]) {
  return settingsOptionAction({
    question,
    changes: changes as SettingMutation[],
    revision: 0,
    defaults_revision: "defaults-1",
  });
}

// 묶음 n의 첫 질문 ID. id()가 같은 번호에 같은 꼬리를 주므로 접두사만 바꾸면 된다.
const qstOf = (group: string) => group.replace(/^qgr_/, "qst_");

type CreateOverrides = Partial<{
  id: string;
  run: string;
  session: string | null;
  prompt: string;
  reason: string;
  options: unknown[];
  recommendation: unknown;
  expires_at: string | null;
  // 질문 여럿인 묶음. 있으면 prompt·reason·options·recommendation은 쓰지 않는다.
  questions: unknown[];
}>;

// 묶음 n. 질문을 따로 주지 않으면 질문 n 하나짜리 묶음이다.
function groupInput(n: number, overrides: CreateOverrides = {}) {
  const { prompt, reason, options, recommendation, questions, ...group } =
    overrides;
  return {
    id: id("qgr", n),
    run: RUN_1,
    session: null,
    expires_at: null,
    ...group,
    questions: questions ?? [{
      id: id("qst", n),
      prompt: prompt ?? `Prompt ${n}`,
      reason: reason ?? `Reason ${n}`,
      options: options ?? [],
      recommendation: recommendation ?? null,
    }],
  };
}

function ask(
  h: LedgerHarness,
  n: number,
  overrides: CreateOverrides = {},
  ctx?: AuthenticatedContext,
) {
  return h.command(
    ctx ?? agentFor(overrides.run ?? RUN_1),
    env("CreateQuestionGroup", groupInput(n, overrides)),
  );
}

async function created(
  h: LedgerHarness,
  n: number,
  overrides: CreateOverrides = {},
) {
  return value(await ask(h, n, overrides)).result as {
    id: string;
    status: string;
    created_seq: string;
  };
}

type Answer =
  | { kind: "option"; option_key: string }
  | { kind: "text"; text: string };

const pick = (key: string): Answer => ({ kind: "option", option_key: key });
const say = (text: string): Answer => ({ kind: "text", text });
const said = (n: number): Answer => say(`free answer ${n}`);

// 저장된 답은 글 대신 그 blob의 hash를 가리킨다.
const storedAnswer = (chosen: Answer) =>
  chosen.kind === "option"
    ? { kind: "option", option_key: chosen.option_key, text_blob: null }
    : { kind: "text", option_key: null, text_blob: sha256Text(chosen.text) };

const CANCEL_TEXT = "The premise changed.";

// 묶음의 답: 질문마다 하나씩. 질문 하나짜리 묶음은 Answer 하나로 줄여 쓴다.
type Submitted = { question: string; answer: Answer };

// 사람 확인 handle. AnswerQuestionAction이 선언한 binding field(group·created_seq·
// answer·binding_hash)가 내용 기준이다. shell의 confirmation window가 사람의 클릭 뒤
// 발급하는 것과 같다.
async function handleFor(
  h: LedgerHarness,
  group: string,
  createdSeq: string,
  answer: Answer,
  bindingHash: string,
): Promise<string> {
  const issued = await h.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: "win-1",
      target_ref: group,
      content_hash: hashOf({
        group,
        created_seq: createdSeq,
        answer,
        binding_hash: bindingHash,
      }),
      allowed_decisions: ["AnswerQuestionAction"],
      expires_at: new Date(NOW + 86_400_000 * 3).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? undefined : JSON.stringify(issued.error));
  return (issued.value as { confirmation: string }).confirmation;
}

// binding_hash가 있으면 사람 확인을 거친 action 답(AnswerQuestionAction)이고, 없으면
// 확인 없는 일반 답(AnswerQuestionGroup)이다.
async function answer(
  h: LedgerHarness,
  group: string,
  createdSeq: string,
  chosen: Answer | readonly Submitted[],
  options: {
    binding_hash?: string | null;
    ctx?: AuthenticatedContext;
    confirmation?: string;
  } = {},
) {
  const binding = options.binding_hash ?? null;
  const answers: readonly Submitted[] = Array.isArray(chosen)
    ? chosen as readonly Submitted[]
    : [{ question: qstOf(group), answer: chosen as Answer }];
  if (binding === null) {
    return h.command(
      options.ctx ?? userCred,
      env(
        "AnswerQuestionGroup",
        { group, created_seq: createdSeq, answers },
        { created_seq: createdSeq },
      ),
    );
  }
  const only = answers[0]!;
  const handle = options.confirmation ??
    await handleFor(h, group, createdSeq, only.answer, binding);
  return h.command(
    options.ctx ?? userCred,
    env(
      "AnswerQuestionAction",
      {
        group,
        created_seq: createdSeq,
        answer: only.answer,
        binding_hash: binding,
        evidence: {
          question: only.question,
          option: (only.answer as { option_key: string }).option_key,
        },
      },
      { created_seq: createdSeq },
      handle,
    ),
  );
}

function closeCommand(
  h: LedgerHarness,
  command: "DeferQuestionGroup" | "ExpireQuestionGroup",
  ctx: AuthenticatedContext,
  group: string,
  createdSeq: string,
) {
  return h.command(
    ctx,
    env(command, { group, created_seq: createdSeq }, {
      created_seq: createdSeq,
    }),
  );
}

function cancel(
  h: LedgerHarness,
  ctx: AuthenticatedContext,
  group: string,
  createdSeq: string,
  reason: "cancelled" | "superseded" = "cancelled",
) {
  return h.command(
    ctx,
    env("CancelQuestionGroup", {
      group,
      created_seq: createdSeq,
      closed_reason: reason,
      closed_reason_text: CANCEL_TEXT,
    }, { created_seq: createdSeq }),
  );
}

type QuestionView = {
  id: string;
  group: string;
  position: number;
  prompt_blob: string;
  reason_blob: string;
  options: { key: string; description_blob: string; action: unknown }[];
  recommendation:
    | { option_key: string | null; explanation_blob: string }
    | null;
  answer: ReturnType<typeof storedAnswer> | null;
  applied: boolean;
};

type GroupView = {
  id: string;
  run: string;
  session: string | null;
  expires_at: string | null;
  status: string;
  closed_reason: string | null;
  closed_reason_blob: string | null;
  created_seq: string;
  closed_seq: string | null;
  questions: QuestionView[];
};

async function readGroup(
  h: LedgerHarness,
  group: string,
  ctx: AuthenticatedContext = userCred,
): Promise<GroupView> {
  const read = value(
    await h.read({ resource: "questions", method: "read" }, ctx, { group }),
  ) as { group: GroupView };
  return read.group;
}

// 질문 하나짜리 묶음을 읽는다: 묶음의 값 위에 그 질문의 값을 얹어 보여 준다.
async function readQuestion(
  h: LedgerHarness,
  group: string,
  ctx: AuthenticatedContext = userCred,
) {
  const view = await readGroup(h, group, ctx);
  assertEquals(view.questions.length, 1);
  return { ...view, ...view.questions[0]!, id: view.id };
}

async function eventsOf(h: LedgerHarness, type: string, subject?: string) {
  return await sql(
    h,
    subject === undefined
      ? "select seq, actor, run, payload from events where type = ? order by seq"
      : "select seq, actor, run, payload from events where type = ? and subject = ? order by seq",
    subject === undefined ? [type] : [type, subject],
  );
}

async function advance(h: LedgerHarness, ms: number) {
  value(await h.command(machineCred, env("AdvanceQuestionClock", { ms })));
}

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

Deno.test("lophn-agent/questions#R1 [agent-I13]: a question already answered in the run is not asked again, alone or inside a new group", async () => {
  const h = await ready();
  try {
    const first = await created(h, 1);
    value(await answer(h, first.id, first.created_seq, said(50)));
    // 같은 본문을 같은 run에 다시 묻는 묶음은 받지 않는다.
    code(await ask(h, 2, { prompt: "Prompt 1" }), "conflict");
    // 새 질문 곁에 이미 받은 질문을 끼워도 같다. 묶음 전체가 거절된다.
    code(
      await ask(h, 4, {
        questions: [
          {
            id: id("qst", 4),
            prompt: "Prompt 4",
            reason: "r",
            options: [],
            recommendation: null,
          },
          {
            id: id("qst", 5),
            prompt: "Prompt 1",
            reason: "r",
            options: [],
            recommendation: null,
          },
        ],
      }),
      "conflict",
    );
    assertEquals((await eventsOf(h, "QuestionCreated")).length, 1);
    // 본문이 다른 새 결정은 질문할 수 있다.
    const second = await created(h, 3);
    assertEquals(second.status, "pending");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R1 [agent-I13]: one group carries one Submit and the first answer closes it", async () => {
  const h = await ready();
  try {
    const q = await created(h, 1, { options: [option("a"), option("b")] });
    value(await answer(h, q.id, q.created_seq, pick("a")));
    // 두 번째 선택은 같은 묶음에 붙지 않는다. 먼저 받은 답이 그대로다.
    code(await answer(h, q.id, q.created_seq, pick("b")), "conflict");
    const read = await readQuestion(h, q.id);
    assertEquals(read.answer, storedAnswer(pick("a")));
    assertEquals((await eventsOf(h, "QuestionAnswered", q.id)).length, 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R1 [agent-I13]: a group holds one to four questions, each with its own id and its own decision", async () => {
  const h = await ready();
  try {
    const question = (n: number, extra: Record<string, unknown> = {}) => ({
      id: id("qst", n),
      prompt: `Prompt ${n}`,
      reason: `Reason ${n}`,
      options: [],
      recommendation: null,
      ...extra,
    });
    // 질문 0개와 5개는 묶음이 아니다. 아무것도 저장하지 않는다.
    code(await ask(h, 1, { questions: [] }), "invalid_input");
    code(
      await ask(h, 1, { questions: [1, 2, 3, 4, 5].map((n) => question(n)) }),
      "invalid_input",
    );
    assertEquals((await eventsOf(h, "QuestionCreated")).length, 0);
    assertEquals(
      Number((await sql(h, "select count(*) as n from questions"))[0]!["n"]),
      0,
    );
    // 같은 질문 ID나 같은 본문을 한 묶음에 두 번 싣는 것은 독립 결정이 아니다.
    code(
      await ask(h, 1, {
        questions: [question(1), question(1, { prompt: "x" })],
      }),
      "invalid_input",
    );
    code(
      await ask(h, 1, {
        questions: [question(1), question(2, { prompt: "Prompt 1" })],
      }),
      "invalid_input",
    );
    // 질문 4개는 한 묶음으로 받고 순서(position)가 1부터 이어진다.
    const four = await created(h, 1, {
      questions: [1, 2, 3, 4].map((n) =>
        question(n, { options: [option(`o${n}`)] })
      ),
    });
    const view = await readGroup(h, four.id);
    assertEquals(view.status, "pending");
    assertEquals(
      view.questions.map((one) => one.id),
      [1, 2, 3, 4].map((n) => id("qst", n)),
    );
    assertEquals(view.questions.map((one) => one.position), [1, 2, 3, 4]);
    assertEquals(view.questions.map((one) => one.group), [
      four.id,
      four.id,
      four.id,
      four.id,
    ]);
    assertEquals(
      view.questions.map((one) => one.prompt_blob),
      [1, 2, 3, 4].map((n) => sha256Text(`Prompt ${n}`)),
    );
    assertEquals((await eventsOf(h, "QuestionCreated", four.id)).length, 1);
    // 질문 ID는 다른 묶음이 다시 쓰지 못한다.
    value(
      await answer(
        h,
        four.id,
        four.created_seq,
        [1, 2, 3, 4].map((n) => ({
          question: id("qst", n),
          answer: pick(`o${n}`),
        })),
      ),
    );
    code(
      await ask(h, 2, { questions: [question(1, { prompt: "Other" })] }),
      "conflict",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R2: a question group needs a live run of the asking assignment", async () => {
  const h = await ready();
  try {
    // 없는 run·남의 assignment의 run은 같은 not_found다.
    code(
      await ask(h, 1, { run: id("run", 30) }, agentFor(RUN_1)),
      "not_found",
    );
    code(await ask(h, 2, { run: RUN_2 }, agentFor(RUN_1)), "not_found");
    code(await ask(h, 3, {}, agentFor(RUN_2)), "not_found");
    // 시작하지 않은 run은 conflict, 끝난 run은 forbidden이다.
    await acceptRun(h, id("run", 4), ASG_LOPHN);
    code(await ask(h, 4, { run: id("run", 4) }), "conflict");
    // 자격에 묶인 run은 그 run의 묶음만 만든다.
    code(
      await ask(h, 5, { run: RUN_4 }, agentFor(RUN_1)),
      "not_found",
    );
    // agent가 아닌 호출자는 질문하지 못한다.
    code(await ask(h, 6, {}, userCred), "forbidden");
    code(await ask(h, 7, {}, machineCred), "forbidden");
    await finishRun(h, RUN_2);
    code(
      await ask(h, 8, { run: RUN_2 }),
      "forbidden",
    );
    assertEquals((await eventsOf(h, "QuestionCreated")).length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R2 [agent-I13]: a run waits on at most one group however many questions it holds and a session is optional", async () => {
  const h = await ready();
  try {
    // 세션 없는 run(handoff로 받은 일 같은)도 묶음을 내고 run·assignment와 함께 읽는다.
    const first = await created(h, 1, {
      questions: [1, 2].map((n) => ({
        id: id("qst", n),
        prompt: `Prompt ${n}`,
        reason: "r",
        options: [],
        recommendation: null,
      })),
    });
    const record = await readGroup(h, first.id);
    assertEquals(record.session, null);
    assertEquals(record.run, RUN_1);
    // 같은 run의 두 번째 대기 묶음은 질문 하나짜리여도 거절한다. 다른 run은 따로 기다린다.
    code(await ask(h, 3), "conflict");
    const ce = value(await ask(h, 4, { run: RUN_2 }))
      .result as {
        status: string;
      };
    assertEquals(ce.status, "pending");
    // 답이 와서 닫히면 같은 run은 다시 질문할 수 있다.
    value(
      await answer(h, first.id, first.created_seq, [
        { question: id("qst", 1), answer: said(60) },
        { question: id("qst", 2), answer: said(61) },
      ]),
    );
    assertEquals((await created(h, 5)).status, "pending");
    // 세션을 지정하려면 run의 세션이어야 한다.
    await finishRun(h, RUN_1);
    await startRun(h, id("run", 5), ASG_LOPHN, SESSION);
    code(
      await ask(h, 6, { run: id("run", 5), session: id("ses", 2) }),
      "invalid_input",
    );
    const withSession = value(
      await ask(h, 7, { run: id("run", 5), session: SESSION }),
    ).result as { status: string };
    assertEquals(withSession.status, "pending");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R3: free input, choices with free input, one recommendation and no option cap", async () => {
  const h = await ready();
  try {
    // 선택지 없는 질문은 자유 입력으로만 답한다.
    const free = await created(h, 1);
    value(await answer(h, free.id, free.created_seq, said(61)));
    assertEquals((await readQuestion(h, free.id)).status, "answered");
    // 선택지가 있어도 자유 입력으로 답할 수 있다. 개수 상한은 없다.
    const keys = Array.from({ length: 12 }, (_, index) => `opt-${index}`);
    const many = await created(h, 2, {
      options: keys.map((key) => option(key)),
      recommendation: {
        option_key: "opt-3",
        explanation: "Explanation 70",
      },
    });
    const record = await readQuestion(h, many.id);
    assertEquals(record.options.map((one) => one.key), keys);
    // 모든 선택지에 설명이 있고 추천은 하나와 그 이유다.
    assert(record.options.every((one) => one.description_blob.length === 64));
    assertEquals(record.recommendation?.option_key, "opt-3");
    assertEquals(
      record.recommendation?.explanation_blob,
      sha256Text("Explanation 70"),
    );
    // 추천은 답도 적용도 아니다.
    assertEquals(record.status, "pending");
    assertEquals(record.answer, null);
    assertEquals(record.applied, false);
    value(await answer(h, many.id, many.created_seq, said(62)));
    assertEquals(
      (await readQuestion(h, many.id)).answer,
      storedAnswer(said(62)),
    );
    // 없는 선택지를 추천하거나 같은 key를 두 번 쓴 묶음은 만들 수 없다.
    code(
      await ask(h, 3, {
        options: [option("a")],
        recommendation: { option_key: "zzz", explanation: "Explanation 71" },
      }),
      "invalid_input",
    );
    code(
      await ask(h, 4, { options: [option("a"), option("a")] }),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R4: a pending group shows its display and detail material and a choice alone answers nothing", async () => {
  const h = await ready();
  try {
    const q = await created(h, 1, {
      options: [
        option("a"),
        option("b", {
          action: settingsAction(id("qst", 1), [
            {
              layer: "common",
              key: "shell.reading_width",
              action: "set",
              value: 90,
            },
          ]),
        }),
      ],
      recommendation: { option_key: "a", explanation: "Explanation 72" },
      expires_at: at(60_000),
    });
    const record = await readQuestion(h, q.id);
    // 기본 화면 자료: 질문·선택지 설명·추천 이유·선택 뒤 동작·기한.
    assertEquals(record.prompt_blob, sha256Text("Prompt 1"));
    assertEquals(
      record.options[0]!.description_blob,
      sha256Text("Description of a"),
    );
    assertEquals(
      record.recommendation?.explanation_blob,
      sha256Text("Explanation 72"),
    );
    assert(record.options[1]!.action !== null);
    assertEquals(record.options[0]!.action, null);
    assertEquals(record.expires_at, at(60_000));
    // 상세 자료: 질문의 이유·관련 run·세션.
    assertEquals(record.reason_blob, sha256Text("Reason 1"));
    assertEquals(record.run, RUN_1);
    assertEquals(record.session, null);
    // 선택하는 것만으로는 답이 아니다. 명시 답 전에는 아무 동작도 없다.
    assertEquals(record.status, "pending");
    assertEquals(record.answer, null);
    assertEquals(record.applied, false);
    assertEquals((await eventsOf(h, "QuestionAnswered")).length, 0);
    // 읽을 수 없는 호출자는 없는 묶음과 같은 답을 받는다.
    code(
      await h.read({ resource: "questions", method: "read" }, agentOf(ASG_CE), {
        group: q.id,
      }),
      "not_found",
    );
    // app 자격은 질문 read의 호출자가 아니다(route의 actor 목록).
    code(
      await h.read({ resource: "questions", method: "read" }, appCred, {
        group: q.id,
      }),
      "forbidden",
    );
    assertEquals((await readQuestion(h, q.id, codingCred)).id, q.id);
    assertEquals((await readQuestion(h, q.id, agentOf(ASG_LOPHN))).id, q.id);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R4 [agent-I13]: the Submit answers every question of the group at once or stores nothing", async () => {
  const h = await ready();
  try {
    const [one, two, three] = [id("qst", 1), id("qst", 2), id("qst", 3)];
    const q = await created(h, 1, {
      questions: [
        {
          id: one,
          prompt: "P1",
          reason: "r",
          options: [option("a"), option("b")],
          recommendation: null,
        },
        {
          id: two,
          prompt: "P2",
          reason: "r",
          options: [],
          recommendation: null,
        },
        {
          id: three,
          prompt: "P3",
          reason: "r",
          options: [option("x")],
          recommendation: null,
        },
      ],
    });
    const none = async () => {
      const view = await readGroup(h, q.id);
      assertEquals(view.status, "pending");
      assertEquals(view.questions.map((one) => one.answer), [null, null, null]);
      assertEquals((await eventsOf(h, "QuestionAnswered")).length, 0);
    };
    // 일부 질문만 답한 Submit은 거절이고 아무것도 저장하지 않는다.
    code(
      await answer(h, q.id, q.created_seq, [{
        question: one,
        answer: pick("a"),
      }]),
      "invalid_input",
    );
    code(
      await answer(h, q.id, q.created_seq, [
        { question: one, answer: pick("a") },
        { question: three, answer: pick("x") },
      ]),
      "invalid_input",
    );
    await none();
    // 묶음에 없는 질문의 답, 같은 질문의 두 답은 받지 않는다.
    code(
      await answer(h, q.id, q.created_seq, [
        { question: one, answer: pick("a") },
        { question: two, answer: said(1) },
        { question: id("qst", 9), answer: said(2) },
      ]),
      "invalid_input",
    );
    code(
      await answer(h, q.id, q.created_seq, [
        { question: one, answer: pick("a") },
        { question: one, answer: pick("b") },
        { question: two, answer: said(1) },
        { question: three, answer: pick("x") },
      ]),
      "invalid_input",
    );
    // 한 질문의 답이 틀리면(없는 선택지·빈 자유 답) 맞은 답도 함께 저장되지 않는다.
    code(
      await answer(h, q.id, q.created_seq, [
        { question: one, answer: pick("a") },
        { question: two, answer: pick("zzz") },
        { question: three, answer: pick("x") },
      ]),
      "invalid_input",
    );
    code(
      await answer(h, q.id, q.created_seq, [
        { question: one, answer: pick("a") },
        { question: two, answer: say("  ") },
        { question: three, answer: pick("x") },
      ]),
      "invalid_input",
    );
    // 다른 질문의 선택지 key는 이 질문의 선택지가 아니다.
    code(
      await answer(h, q.id, q.created_seq, [
        { question: one, answer: pick("x") },
        { question: two, answer: said(1) },
        { question: three, answer: pick("x") },
      ]),
      "invalid_input",
    );
    await none();
    // 모든 질문에 하나씩 답한 Submit 한 번이 묶음 전체를 닫고 event도 하나다. 질문 순서로 정리된다.
    const done = value(
      await answer(h, q.id, q.created_seq, [
        { question: three, answer: pick("x") },
        { question: one, answer: pick("b") },
        { question: two, answer: said(3) },
      ]),
    ).result as { status: string; closed_seq: string };
    assertEquals(done.status, "answered");
    const view = await readGroup(h, q.id);
    assertEquals(view.status, "answered");
    assertEquals(view.closed_seq, done.closed_seq);
    assertEquals(view.questions.map((one) => one.answer), [
      storedAnswer(pick("b")),
      storedAnswer(said(3)),
      storedAnswer(pick("x")),
    ]);
    const answered = await eventsOf(h, "QuestionAnswered");
    assertEquals(answered.length, 1);
    assertEquals(
      (JSON.parse(String(answered[0]!["payload"])) as {
        answers: { question: string }[];
      }).answers.map((entry) => entry.question),
      [one, two, three],
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R4: the list narrows by run, assignment and status within the caller's scope", async () => {
  const h = await ready();
  try {
    const a = await created(h, 1);
    await ask(h, 2, { run: RUN_2 }).then(value);
    value(await answer(h, a.id, a.created_seq, said(63)));
    const list = async (ctx: AuthenticatedContext, input: unknown) =>
      (value(
        await h.read({ resource: "questions", method: "list" }, ctx, input),
      ) as { groups: GroupView[] }).groups;
    assertEquals((await list(userCred, {})).length, 2);
    assertEquals(
      (await list(userCred, { status: "pending" })).map((q) => q.run),
      [
        RUN_2,
      ],
    );
    assertEquals((await list(userCred, { run: RUN_1 })).map((q) => q.id), [
      a.id,
    ]);
    assertEquals(
      (await list(userCred, { assignment: ASG_CE })).map((q) => q.run),
      [RUN_2],
    );
    // 묶음 목록은 질문을 묶음 안에 담아 돌려준다.
    assertEquals(
      (await list(userCred, { run: RUN_1 }))[0]!.questions.map((q) => q.id),
      [id("qst", 1)],
    );
    // agent는 자기 assignment의 묶음만 본다. 남의 assignment를 지정해도 빈 목록이다.
    assertEquals((await list(agentOf(ASG_CE), {})).map((q) => q.run), [RUN_2]);
    assertEquals(
      (await list(agentOf(ASG_CE), { assignment: ASG_LOPHN })).length,
      0,
    );
    code(
      await h.read({ resource: "questions", method: "list" }, appCred, {}),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R5 [agent-I13]: group content is never overwritten, a change closes the original group and asks anew", async () => {
  const h = await ready();
  try {
    const q = await created(h, 1, { options: [option("a")] });
    // 열어 둔 묶음의 기한·run과 질문의 본문·선택지는 ledger 표에서도 바뀌지 않는다.
    for (
      const column of ["expires_at", "run", "session", "created_seq"]
    ) {
      const changed = await h.probeWrite(
        `update question_groups set ${column} = ${
          column === "created_seq" ? "99" : "'x'"
        } where id = ?`,
        [q.id],
      );
      assert(!changed.ok, `${column} of the group was overwritten`);
    }
    for (
      const column of [
        "prompt_blob",
        "reason_blob",
        "options",
        "recommendation",
        "position",
        '"group"',
      ]
    ) {
      const changed = await h.probeWrite(
        `update questions set ${column} = ${
          column === "options" ? "'[]'" : column === "position" ? "3" : "'x'"
        } where id = ?`,
        [id("qst", 1)],
      );
      assert(!changed.ok, `${column} of the question was overwritten`);
    }
    assert(
      !(await h.probeWrite("delete from question_groups where id = ?", [q.id]))
        .ok,
    );
    assert(
      !(await h.probeWrite("delete from questions where id = ?", [
        id("qst", 1),
      ])).ok,
    );
    // 같은 ID로 다른 내용을 보내는 것(선택지를 바꾸거나 질문을 더하는 것)은 덮어쓰기가 아니라 conflict다.
    code(
      await ask(h, 1, { options: [option("a"), option("b")] }),
      "conflict",
    );
    code(
      await ask(h, 1, {
        questions: [
          {
            id: id("qst", 1),
            prompt: "Prompt 1",
            reason: "Reason 1",
            options: [option("a")],
            recommendation: null,
          },
          {
            id: id("qst", 2),
            prompt: "Prompt 2",
            reason: "r",
            options: [],
            recommendation: null,
          },
        ],
      }),
      "conflict",
    );
    // 바꾸려면 이유와 함께 원래 묶음을 닫고 새 묶음을 낸다.
    code(await ask(h, 2, { options: [option("a"), option("b")] }), "conflict");
    value(
      await cancel(h, agentFor(RUN_1), q.id, q.created_seq, "superseded"),
    );
    const replaced = await created(h, 2, {
      options: [option("a"), option("b")],
    });
    assert(replaced.id !== q.id);
    const original = await readQuestion(h, q.id);
    assertEquals(original.options.map((one) => one.key), ["a"]);
    assertEquals(original.closed_reason, "superseded");
    assertEquals(original.closed_reason_blob, sha256Text(CANCEL_TEXT));
    assertEquals(
      (await readQuestion(h, replaced.id)).options.map((one) => one.key),
      ["a", "b"],
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R6 [agent-I13]: only the person's explicit Submit to the named group counts", async () => {
  const h = await ready();
  try {
    const q = await created(h, 1, { options: [option("a")] });
    // agent·machine·다른 자격은 답하지 못한다.
    for (const ctx of [agentFor(RUN_1), machineCred]) {
      code(
        await answer(h, q.id, q.created_seq, pick("a"), { ctx }),
        "forbidden",
      );
    }
    // 빈 답과 없는 선택지는 답이 아니다.
    code(await answer(h, q.id, q.created_seq, say("  \n ")), "invalid_input");
    code(await answer(h, q.id, q.created_seq, pick("zzz")), "invalid_input");
    // 없는 묶음과 질문 ID만 가리킨 답은 묶음을 지정한 것이 아니다.
    code(
      await answer(h, id("qgr", 40), q.created_seq, pick("a")),
      "not_found",
    );
    assertEquals((await readQuestion(h, q.id)).status, "pending");
    assertEquals((await eventsOf(h, "QuestionAnswered")).length, 0);
    // 미루기와 취소는 답이 아니라 묶음 전체의 답 없음 종료다.
    value(
      await closeCommand(
        h,
        "DeferQuestionGroup",
        userCred,
        q.id,
        q.created_seq,
      ),
    );
    const after = await readQuestion(h, q.id);
    assertEquals(after.status, "cancelled");
    assertEquals(after.answer, null);
    assertEquals(after.closed_reason, "deferred");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R6 [agent-I13]: a general session message is not an answer to a waiting group", async () => {
  const h = await open();
  try {
    await seedAssignments(h);
    value(
      await h.command(machineCred, env("SeedProject", { id: id("prj", 1) })),
    );
    value(
      await h.command(
        userCred,
        env("OpenSession", {
          id: SESSION,
          assignment: ASG_LOPHN,
          work_place: { kind: "project", id: id("prj", 1) },
          opening_context: null,
        }, { assignment_revision: 1, assignment_state: "enabled" }),
      ),
    );
    await startRun(h, RUN_1, ASG_LOPHN, SESSION);
    const q = await created(h, 1, {
      session: SESSION,
      options: [option("yes")],
    });
    // 대기 중인 세션에 사람이 동의한다는 말을 보낸다.
    const seq = String(
      (await sql(
        h,
        "select cast(state_seq as text) as s from sessions where id = ?",
        [SESSION],
      ))[0]!["s"],
    );
    value(
      await h.command(
        userCred,
        env("ReceiveMessage", {
          id: id("msg", 90),
          session: SESSION,
          content: textContent("yes"),
          mode: "request",
        }, {
          session_state: "open",
          session_state_seq: seq,
          assignment_revision: 1,
          assignment_state: "enabled",
        }),
      ),
    );
    const record = await readQuestion(h, q.id);
    assertEquals(record.status, "pending");
    assertEquals(record.answer, null);
    assertEquals((await eventsOf(h, "QuestionAnswered")).length, 0);
    assertEquals(
      Number((await sql(h, "select count(*) as n from messages"))[0]!["n"]),
      1,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R7 [agent-I13]: no deadline by default and an explicit deadline closes the group's answers at its boundary", async () => {
  const h = await ready();
  try {
    // 기한이 없는 묶음은 900초도 3600초도 하루도 지나 답을 받는다.
    const open = await created(h, 1);
    assertEquals((await readQuestion(h, open.id)).expires_at, null);
    await advance(h, 86_400_000);
    code(
      await closeCommand(
        h,
        "ExpireQuestionGroup",
        machineCred,
        open.id,
        open.created_seq,
      ),
      "conflict",
    );
    value(await answer(h, open.id, open.created_seq, said(64)));
    // 지나간 기한은 묶음으로 만들 수 없다.
    code(
      await ask(h, 2, { expires_at: at(86_400_000) }),
      "invalid_input",
    );
    // 기한 1ms 전 답은 받고, 경계 시각부터는 받지 않는다. 기한은 묶음 하나가 가진다.
    const deadline = at(86_400_000 + 10_000);
    const before = await created(h, 3, { expires_at: deadline });
    const boundary = value(
      await ask(h, 4, {
        run: RUN_2,
        expires_at: deadline,
        questions: [5, 6].map((n) => ({
          id: id("qst", n),
          prompt: `Prompt ${n}`,
          reason: "r",
          options: [],
          recommendation: null,
        })),
      }),
    ).result as { id: string; created_seq: string };
    await advance(h, 9_999);
    value(await answer(h, before.id, before.created_seq, said(65)));
    await advance(h, 1);
    code(
      await answer(h, boundary.id, boundary.created_seq, [
        { question: id("qst", 5), answer: said(66) },
        { question: id("qst", 6), answer: said(67) },
      ]),
      "conflict",
    );
    // 미루기도 경계부터는 받지 않는다. 늦은 답은 받지 않고 묶음은 machine의 만료로만 닫힌다.
    code(
      await closeCommand(
        h,
        "DeferQuestionGroup",
        userCred,
        boundary.id,
        boundary.created_seq,
      ),
      "conflict",
    );
    assertEquals((await readGroup(h, boundary.id)).status, "pending");
    value(
      await closeCommand(
        h,
        "ExpireQuestionGroup",
        machineCred,
        boundary.id,
        boundary.created_seq,
      ),
    );
    const expired = await readGroup(h, boundary.id);
    assertEquals(expired.status, "expired");
    assertEquals(expired.questions.map((one) => one.answer), [null, null]);
    assertEquals(expired.expires_at, deadline);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R8 [agent-I13]: deferring, expiring and cancelling end the whole group without an answer and apply nothing", async () => {
  const h = await ready();
  try {
    const action = (n: number) =>
      settingsAction(id("qst", n), [
        {
          layer: "common",
          key: "shell.reading_width",
          action: "set",
          value: 90,
        },
      ]);
    const deferred = await created(h, 1, {
      options: [option("go", { action: action(1) })],
    });
    value(
      await closeCommand(
        h,
        "DeferQuestionGroup",
        userCred,
        deferred.id,
        deferred.created_seq,
      ),
    );
    const expiring = value(
      await ask(h, 2, {
        run: RUN_2,
        options: [option("go", { action: action(2) })],
        expires_at: at(1_000),
      }),
    ).result as { id: string; created_seq: string };
    await advance(h, 1_000);
    value(
      await closeCommand(
        h,
        "ExpireQuestionGroup",
        machineCred,
        expiring.id,
        expiring.created_seq,
      ),
    );
    // 질문이 여럿인 묶음도 취소하면 질문 전부가 답 없이 닫힌다.
    const cancelled = await created(h, 3, {
      questions: [3, 4].map((n) => ({
        id: id("qst", n),
        prompt: `Prompt ${n}`,
        reason: "r",
        options: [option("go")],
        recommendation: null,
      })),
    });
    value(await cancel(h, userCred, cancelled.id, cancelled.created_seq));
    const states = [
      [deferred.id, "cancelled", "deferred", null],
      [expiring.id, "expired", "expired", null],
      [cancelled.id, "cancelled", "cancelled", sha256Text(CANCEL_TEXT)],
    ] as const;
    for (const [group, status, reason, blob] of states) {
      const record = await readGroup(h, group);
      assertEquals(record.status, status);
      assertEquals(record.closed_reason, reason);
      assertEquals(record.closed_reason_blob, blob);
      // 어느 질문에도 답도 적용도 없고 기본 선택으로 읽히지 않는다.
      for (const question of record.questions) {
        assertEquals(question.answer, null);
        assertEquals(question.applied, false);
      }
    }
    assertEquals((await readGroup(h, cancelled.id)).questions.length, 2);
    assertEquals((await eventsOf(h, "QuestionAnswered")).length, 0);
    const cancelledEvents = await eventsOf(h, "QuestionCancelled");
    assertEquals(
      cancelledEvents.map((row) => JSON.parse(String(row["payload"])).deferred),
      [true, false],
    );
    assertEquals((await eventsOf(h, "QuestionExpired")).length, 1);
    // 침묵은 취소도 답도 아니다. 시간이 지나도 기한 없는 묶음은 대기로 남는다.
    const silent = value(await ask(h, 5)).result as { id: string };
    await advance(h, 86_400_000);
    assertEquals((await readQuestion(h, silent.id)).status, "pending");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R9 [agent-I13]: a group the run no longer needs closes with a reason and late or duplicate Submits apply nothing", async () => {
  const h = await ready();
  try {
    const q = await created(h, 1, { options: [option("a"), option("b")] });
    // machine은 일이 끝나지 않았고 전제도 바뀌지 않았으면 닫지 못한다.
    code(await cancel(h, machineCred, q.id, q.created_seq), "forbidden");
    // 질문하지 않은 assignment의 agent는 없는 묶음과 같다.
    code(await cancel(h, agentFor(RUN_2), q.id, q.created_seq), "not_found");
    // 이미 받은 답을 다시 보내면 같은 답은 저장된 결과를, 다른 답은 conflict를 받는다.
    const first = value(await answer(h, q.id, q.created_seq, pick("a")));
    const replay = value(await answer(h, q.id, q.created_seq, pick("a")));
    assertEquals(
      (replay.result as { replayed: boolean }).replayed,
      true,
    );
    assertEquals(
      (first.result as { closed_seq: string }).closed_seq,
      (replay.result as { closed_seq: string }).closed_seq,
    );
    code(await answer(h, q.id, q.created_seq, pick("b")), "conflict");
    assertEquals(
      (await readQuestion(h, q.id)).answer,
      storedAnswer(pick("a")),
    );
    assertEquals((await eventsOf(h, "QuestionAnswered", q.id)).length, 1);
    // 닫힌 묶음은 다시 닫히지 않는다.
    code(await cancel(h, userCred, q.id, q.created_seq), "conflict");
    code(
      await closeCommand(
        h,
        "DeferQuestionGroup",
        userCred,
        q.id,
        q.created_seq,
      ),
      "conflict",
    );
    // 끝난 run의 묶음은 답을 받지 않고 machine이 이유와 함께 닫는다.
    const orphan = value(await ask(h, 2, { run: RUN_2 }))
      .result as {
        id: string;
        created_seq: string;
      };
    await finishRun(h, RUN_2);
    code(
      await answer(h, orphan.id, orphan.created_seq, said(67)),
      "conflict",
    );
    value(await cancel(h, machineCred, orphan.id, orphan.created_seq));
    const closed = await readQuestion(h, orphan.id);
    assertEquals(closed.status, "cancelled");
    assertEquals(closed.closed_reason_blob, sha256Text(CANCEL_TEXT));
    // 틀린 created_seq는 내용이 바뀐 묶음으로 거절한다.
    const premise = await created(h, 3);
    code(
      await answer(h, premise.id, "999", said(68)),
      "conflict",
    );
    // 전제가 바뀌었다는 이유(superseded)는 run이 살아 있어도 machine이 닫는다.
    value(
      await cancel(
        h,
        machineCred,
        premise.id,
        premise.created_seq,
        "superseded",
      ),
    );
    assertEquals(
      (await readQuestion(h, premise.id)).closed_reason,
      "superseded",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R10 [agent-I13]: a pending group and its answer live in the ledger, and an accepted answer is not an applied one", async () => {
  const h = await ready();
  try {
    const action = settingsAction(id("qst", 1), [
      { layer: "common", key: "shell.reading_width", action: "set", value: 90 },
    ]);
    const q = await created(h, 1, {
      options: [option("apply", { action })],
      expires_at: at(3_600_000),
    });
    // 대기 묶음은 표와 event에 있다(메모리 promise가 아니다).
    const stored = (await sql(
      h,
      "select status, expires_at from question_groups where id = ?",
      [q.id],
    ))[0]!;
    assertEquals(String(stored["status"]), "pending");
    assertEquals(String(stored["expires_at"]), at(3_600_000));
    const rows = await sql(
      h,
      `select prompt_blob, position, answer from questions where "group" = ?`,
      [q.id],
    );
    assertEquals(rows.length, 1);
    assertEquals(String(rows[0]!["prompt_blob"]), sha256Text("Prompt 1"));
    assertEquals(Number(rows[0]!["position"]), 1);
    assertEquals(rows[0]!["answer"], null);
    assertEquals((await eventsOf(h, "QuestionCreated", q.id)).length, 1);
    // 고정 action 선택은 만든 때의 binding으로만 받는다.
    code(
      await answer(h, q.id, q.created_seq, pick("apply"), {
        binding_hash: "0".repeat(64),
      }),
      "conflict",
    );
    // user token은 클릭의 증거가 아니다(platform/identity#R14): action이 있는 선택지는
    // 확인 없는 일반 답으로 받지 않는다.
    code(await answer(h, q.id, q.created_seq, pick("apply")), "forbidden");
    // 근거가 이 묶음의 질문이 아니면 action 답으로 받지 않는다.
    code(
      await answer(
        h,
        q.id,
        q.created_seq,
        [{ question: id("qst", 7), answer: pick("apply") }],
        { binding_hash: action.binding_hash },
      ),
      "invalid_input",
    );
    assertEquals((await readQuestion(h, q.id)).status, "pending");
    const accepted = value(
      await answer(h, q.id, q.created_seq, pick("apply"), {
        binding_hash: action.binding_hash,
      }),
    ).result as { status: string; closed_seq: string };
    assertEquals(accepted.status, "answered");
    // 답 접수는 적용 완료가 아니다. 읽기는 둘을 구별해 낸다.
    const record = await readQuestion(h, q.id);
    assertEquals(record.status, "answered");
    assertEquals(record.answer, storedAnswer(pick("apply")));
    assertEquals(record.closed_seq, accepted.closed_seq);
    assertEquals(record.expires_at, at(3_600_000));
    assertEquals(record.applied, false);
    const answered = (await eventsOf(h, "QuestionAnswered", q.id))[0]!;
    assertEquals(String(answered["actor"]), "user");
    assertEquals(
      JSON.parse(String(answered["payload"])).binding_hash,
      action.binding_hash,
    );
    // 답은 질문 쪽에 한 번만 채워지고 다시 쓰이지 않는다.
    assert(
      !(await h.probeWrite("update questions set answer = ? where id = ?", [
        JSON.stringify(storedAnswer(say("other"))),
        id("qst", 1),
      ])).ok,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R11: an answer that looks like a secret is held back and the person is pointed to protected input", async () => {
  const passed = (value: string): RedactionResult => ({
    rule_revision: "r1",
    status: "passed",
    content: { kind: "inline", value },
    redacted_items: [],
    omissions: [],
  });
  const omitted = (
    reason: "secret_detected" | "redaction_failed" | "uncertain",
  ): RedactionResult => ({
    rule_revision: "r1",
    status: "omitted",
    content: null,
    redacted_items: [],
    omissions: [{ location: "submission", reason, message: "withheld" }],
  });
  const seen: string[] = [];
  const redactor =
    (result: RedactionResult | "throw") => (_input: unknown, body: string) => {
      seen.push(body);
      return result === "throw"
        ? Promise.reject(new Error("redactor is down"))
        : Promise.resolve(result);
    };
  // 일반 글은 그대로 일반 저장으로 간다.
  assertEquals(
    await screenAnswerText(
      "use the blue one",
      redactor(passed("use the blue one")),
    ),
    { status: "accepted", text: "use the blue one" },
  );
  // secret은 글을 돌려주지 않고 platform/secrets의 보호 입력을 안내한다.
  const secret = await screenAnswerText(
    "sk-live-0000",
    redactor(omitted("secret_detected")),
  );
  assertEquals(secret, {
    status: "secure_input",
    guidance: SECURE_INPUT_GUIDANCE,
  });
  assert(!JSON.stringify(secret).includes("sk-live"));
  // 판정을 못 하면 막는다(질문 Q23): 던짐·실패·불확실·부분 결과 모두 같다.
  for (
    const result of [
      "throw",
      omitted("redaction_failed"),
      omitted("uncertain"),
      {
        ...passed("x"),
        status: "partial",
        omissions: [{ location: "body", reason: "private", message: "m" }],
      },
    ] as const
  ) {
    assertEquals(
      await screenAnswerText("anything", redactor(result as never)),
      {
        status: "unavailable",
      },
    );
  }
  // 빈 답·공백뿐인 답은 판정기까지 가지 않는다.
  const calls = seen.length;
  assertEquals(await screenAnswerText("  \n\t ", redactor(passed(" "))), {
    status: "blank",
  });
  assertEquals(seen.length, calls);
  // 막힌 답은 저장되지 않으므로 질문은 미답으로 남는다.
  const h = await ready();
  try {
    const q = await created(h, 1);
    await screenAnswerText(
      "password: hunter2",
      redactor(omitted("secret_detected")),
    );
    const record = await readQuestion(h, q.id);
    assertEquals(record.status, "pending");
    assertEquals(record.answer, null);
    assertEquals((await eventsOf(h, "QuestionAnswered")).length, 0);
    assertEquals(
      (await sql(
        h,
        "select count(*) as n from events where payload like '%hunter2%'",
      ))[0]!["n"],
      0n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R12 [agent-I13]: an answer or a recommendation stands in for no approval or permission", async () => {
  const h = await ready();
  try {
    const grant = {
      concern: "platform/approvals",
      command: "grant_approval_request",
      targets: [id("apr", 1)],
      input: { kind: "inline", value: { approval: id("apr", 1) } },
      input_hash: hashOf({ approval: id("apr", 1) }),
      comparison: {},
      binding_hash: hashOf("grant"),
    };
    const external = {
      concern: "apps",
      command: "activate_release",
      targets: [id("app", 1)],
      input: { kind: "inline", value: { app: id("app", 1) } },
      input_hash: hashOf({ app: id("app", 1) }),
      comparison: {},
      binding_hash: hashOf("activate"),
    };
    // 권한 부여·외부 효과를 고르는 선택지는 묶음으로 만들 수 없다.
    code(
      await ask(h, 1, { options: [option("grant", { action: grant })] }),
      "forbidden",
    );
    code(
      await ask(h, 2, { options: [option("send", { action: external })] }),
      "forbidden",
    );
    // settings 동작도 변경 목록이 없거나 키가 겹치면 만들 수 없다.
    const none = settingsAction(id("qst", 3), []);
    code(
      await ask(h, 3, { options: [option("x", { action: none })] }),
      "invalid_input",
    );
    // 허용한 동작 선택지의 답은 approval·grant·설정 변경을 만들지 않는다.
    const changes = [
      { layer: "common", key: "shell.reading_width", action: "set", value: 90 },
    ];
    const action = settingsAction(id("qst", 4), changes);
    const q = await created(h, 4, {
      options: [option("apply", { action })],
      recommendation: { option_key: "apply", explanation: "Explanation 73" },
    });
    const events = async () =>
      Number((await sql(h, "select count(*) as n from events"))[0]!["n"]);
    const before = await events();
    value(
      await answer(h, q.id, q.created_seq, pick("apply"), {
        binding_hash: action.binding_hash,
      }),
    );
    // 새 event는 QuestionAnswered 하나뿐이고 approval·settings event나 표가 없다.
    assertEquals((await events()) - before, 1);
    for (
      const type of [
        "ApprovalRequestCreated",
        "ApprovalGranted",
        "SettingsChanged",
        "AppReleaseActivated",
      ]
    ) {
      assertEquals((await eventsOf(h, type)).length, 0);
    }
    assertEquals(
      Number(
        (await sql(h, "select count(*) as n from setting_choices"))[0]!["n"],
      ),
      0,
    );
    // 묶음 event는 질문마다 선택지 key와 settings 변경 목록만 싣는다(platform/settings#R29).
    const createdEvent = JSON.parse(
      String((await eventsOf(h, "QuestionCreated", q.id))[0]!["payload"]),
    );
    assertEquals(createdEvent.questions, [{
      id: id("qst", 4),
      options: [{ key: "apply", changes }],
    }]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R13 [agent-I13]: a question with a fixed action is a group of one and its answer is the confirmed one", async () => {
  const h = await ready();
  try {
    const action = settingsAction(id("qst", 1), [
      { layer: "common", key: "shell.reading_width", action: "set", value: 90 },
    ]);
    const plain = (n: number) => ({
      id: id("qst", n),
      prompt: `Prompt ${n}`,
      reason: "r",
      options: [option("keep")],
      recommendation: null,
    });
    // 고정 action이 있는 질문은 다른 질문과 한 묶음으로 낼 수 없다.
    code(
      await ask(h, 1, {
        questions: [
          { ...plain(1), options: [option("apply", { action })] },
          plain(2),
        ],
      }),
      "invalid_input",
    );
    code(
      await ask(h, 1, {
        questions: [
          plain(2),
          { ...plain(1), options: [option("apply", { action })] },
        ],
      }),
      "invalid_input",
    );
    assertEquals((await eventsOf(h, "QuestionCreated")).length, 0);
    // 혼자 낸 묶음은 받는다. 설정 선택지도 한 묶음의 한 질문이다.
    const alone = await created(h, 1, {
      questions: [{ ...plain(1), options: [option("apply", { action })] }],
    });
    assertEquals((await readGroup(h, alone.id)).questions.length, 1);
    // action이 있는 선택지의 답은 확인 없는 Submit으로 받지 않는다.
    code(
      await answer(h, alone.id, alone.created_seq, pick("apply")),
      "forbidden",
    );
    assertEquals((await readGroup(h, alone.id)).status, "pending");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R9: a bound agent credential closes only its own asked group", async () => {
  const h = await ready();
  try {
    await finishRun(h, RUN_1);
    await startRun(h, RUN_5, ASG_LOPHN);
    const bound = agentFor(RUN_5);
    const q = value(
      await ask(h, 1, { run: RUN_5 }, bound),
    ).result as { id: string; created_seq: string };
    // 자격에 묶인 run이 event envelope의 run이 된다.
    assertEquals(
      String((await eventsOf(h, "QuestionCreated", q.id))[0]!["run"]),
      RUN_5,
    );
    assertEquals(
      String((await eventsOf(h, "QuestionCreated", q.id))[0]!["actor"]),
      `agent:${ASG_LOPHN}`,
    );
    value(await cancel(h, bound, q.id, q.created_seq));
    assertEquals((await readQuestion(h, q.id)).status, "cancelled");
    const rows = await sql(
      h,
      "select status, run from question_groups where id = ?",
      [q.id],
    );
    assertEquals(String(rows[0]!["status"]), "cancelled");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/questions#R11: the real redaction engine holds back a secret answer before it is stored", async () => {
  const registry = createKnownSecretRegistry();
  registry.register(["hunter2-known-secret"]);
  const engine = createRedactionEngine({ registry });
  const redact = (input: RedactionInput, body: string) =>
    engine.redact(input, body);
  // 일반 답은 그대로 저장 길로 간다.
  assertEquals(
    await screenAnswerText("Move it under Notes, please.", redact),
    { status: "accepted", text: "Move it under Notes, please." },
  );
  // 고정 prefix credential·등록된 secret·PEM은 모두 보호 입력으로 안내하고 글을 돌려주지 않는다.
  for (
    const secret of [
      "key is sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123",
      "my password is hunter2-known-secret",
      "-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAT8w\n-----END PRIVATE KEY-----",
    ]
  ) {
    const screened = await screenAnswerText(secret, redact);
    assertEquals(screened, {
      status: "secure_input",
      guidance: SECURE_INPUT_GUIDANCE,
    });
    assert(!JSON.stringify(screened).includes("hunter2"));
  }
  // 엔진이 판정을 못 하면(한도 초과) 저장 길로 보내지 않는다.
  const tiny = createRedactionEngine({ registry, limits: { maxBytes: 8 } });
  assertEquals(
    await screenAnswerText(
      "this answer is longer than the limit",
      (input, body) => tiny.redact(input, body),
    ),
    { status: "unavailable" },
  );
  // 막힌 답은 저장되지 않으므로 질문은 미답으로 남고 ledger에 평문이 없다.
  const h = await ready();
  try {
    const q = await created(h, 1);
    await screenAnswerText(
      "key is sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv",
      redact,
    );
    assertEquals((await readQuestion(h, q.id)).status, "pending");
    assertEquals(
      (await sql(
        h,
        "select count(*) as n from events where payload like '%sk-ant%'",
      ))[0]!["n"],
      0n,
    );
  } finally {
    await h.close();
  }
});
