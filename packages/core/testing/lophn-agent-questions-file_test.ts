import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  type LophnError,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  BlobRefRegistration,
  SettingMutation,
} from "../../protocol/server/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import {
  defineTxPort,
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runAdmission,
  runCommand,
} from "../storage/ledger/mod.ts";
import {
  confirmationBridge,
  ConfirmationRegistry,
} from "../server/identity/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../lophn-agent/assignments/mod.ts";
import {
  createRunCommands,
  runSchemaSteps,
} from "../lophn-agent/run-loop/mod.ts";
import {} from "../lophn-agent/run-loop/testing/mod.ts";
import {
  createQuestionCommands,
  createQuestionReads,
  questionSchemaSteps,
  settingsOptionAction,
} from "../lophn-agent/tools/questions/mod.ts";
import {
  agentRun,
  cred,
  groupOf,
  hashOf,
  id,
  optionOf,
  questionOf,
} from "../lophn-agent/tools/questions/testing/mod.ts";

// 질문의 파일 ledger 시험. 명령마다 새 connection으로 실행하고 commit 직후 닫아(kill과
// 같다) 다시 연 파일에서 저장된 사실을 읽는다. 사람 확인(confirmation) handle은 core
// 프로세스 메모리에만 있어 재시작에 사라지므로 시험은 재시작마다 registry를 새로 만든다.
// harness로는 닫고 다시 열 수 없어 이 자리가 맡는다. 실제 provider를 부르지 않고 사람
// 데이터 root를 열지 않는다.

const NOW = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;
const ASG = id("asg", 1);
const RUN = id("run", 1);
const BASIS = "b".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };
const WIDTH = [{
  layer: "common",
  key: "shell.reading_width",
  action: "set",
  value: 90,
}];

async function fileLedger() {
  const dir = await Deno.makeTempDir({ prefix: "questions-file-" });
  const path = `${dir}/ledger.db`;
  const clock = manualClock(NOW);
  const applied = await applyMigrations(
    path,
    [
      ...LEDGER_SCHEMA_STEPS,
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      ...questionSchemaSteps,
      {
        id: "questions.file.setting-choices",
        sql:
          "create table setting_choices (layer text not null check (layer = 'common'), key text not null, value json not null, primary key (layer, key))",
      },
    ],
    { clock },
  );
  assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
  // core 프로세스의 메모리 상태다. 재시작은 이 값을 버린다.
  let registry = new ConfirmationRegistry({
    clock,
    random: (bytes) => seededRandom(7).fill(bytes),
  });
  let epoch = 0;
  const assignments = createAssignmentCommands();
  const runs = createRunCommands({ hasUnappliedSteering: () => false });
  const questions = createQuestionCommands();
  const commands = [
    assignments.createBuiltin,
    runs.accept,
    runs.start,
    questions.create,
    questions.answer,
    questions.answerAction,
    questions.defer,
    questions.cancel,
    questions.expire,
  ];
  const deps = () => ({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1 + epoch) }),
    ports: [
      defineTxPort(runAdmission, (tx) => ({
        status: (run: string) => {
          const row = tx.sql.get("select state from runs where id = ?", [run]);
          if (row === undefined) return "unknown" as const;
          return row["state"] === "finished"
            ? "finished" as const
            : "active" as const;
        },
      })),
    ],
    // 글 참조 등록은 준비 증거가 있어야 통과한다. 실제 준비·만기 판정은 core 전체
    // 시험(question-text_test.ts)이 보고, 여기서는 등록이 같은 transaction에 걸리는 것만 쓴다.
    registerBlobRef: (reference: BlobRefRegistration) =>
      reference.source.kind === "prepared"
        ? ok({
          owner_kind: reference.owner_kind,
          owner_key: reference.owner_key,
          field: reference.field,
          hash: reference.source.blob.hash,
          registered_seq: reference.registered_seq,
        })
        : err<LophnError>({ code: "forbidden", message: "prepared only" }),
    call: () =>
      err<LophnError>({ code: "unavailable", message: "dispatch 없음" }),
    checkCredential: (ctx: AuthenticatedContext) => ok(ctx),
    confirmation: confirmationBridge(registry),
  });
  let key = 0;
  const execute = async (
    ctx: AuthenticatedContext,
    command: string,
    input: unknown,
    compare: unknown,
    confirmation?: string,
  ) => {
    const opened = openConnection(path);
    assert(opened.ok, "open");
    try {
      return await runCommand(opened.value, deps(), commands, ctx, {
        command,
        input,
        idempotency_key: `file-${++key}`,
        compare,
        prepared: [],
        ...(confirmation === undefined ? {} : { confirmation }),
      });
    } finally {
      opened.value.close();
    }
  };
  const must = async (...args: Parameters<typeof execute>) => {
    const result = await execute(...args);
    assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
    return result;
  };
  const reopen = <T>(
    read: (
      snapshot: Parameters<
        ReturnType<typeof createQuestionReads>["read"]["handle"]
      >[0],
    ) => T,
  ): T => {
    const opened = openConnection(path);
    assert(opened.ok, "reopen");
    try {
      return read({
        sql: opened.value.sql,
        as_of_seq: "0",
        port: () => {
          throw new Error("no port");
        },
      });
    } finally {
      opened.value.close();
    }
  };
  const observe = (query: string, params: (string | number)[] = []) =>
    reopen((snapshot) => snapshot.sql.get(query, params));
  // core 재시작: 열린 connection·메모리 상태가 모두 사라지고 파일만 남는다.
  const restart = () => {
    epoch++;
    registry = new ConfirmationRegistry({
      clock,
      random: (bytes) => seededRandom(100 + epoch).fill(bytes),
    });
  };
  const handle = (
    group: string,
    createdSeq: string,
    answer: unknown,
    bindingHash: string,
  ) => {
    const issued = registry.issue({
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
      expires_at: new Date(clock.nowMs() + HOUR).toISOString(),
    });
    assert(issued.ok, "issue");
    return issued.value.confirmation;
  };
  const read = (group: string) =>
    reopen((snapshot) => {
      const found = createQuestionReads().read.handle(
        snapshot,
        cred("user"),
        { group },
      );
      assert(found.ok, found.ok ? "" : JSON.stringify(found.error));
      return found.value.group;
    });
  const machine = cred("machine");
  await must(machine, "CreateBuiltinAssignment", {
    id: ASG,
    role: "lophn",
    scope: { kind: "all", id: null },
  }, {});
  const startRun = async (run: string) => {
    await must(machine, "AcceptRun", {
      id: run,
      assignment: ASG,
      session: null,
      source: { kind: "message", message: id("msg", Number(run.slice(-1))) },
      continued_from: null,
      start_after: null,
    }, { assignment_revision: 1 });
    const seq = String(
      observe(
        "select cast(state_seq as text) as s from runs where id = ?",
        [run],
      )!["s"],
    );
    await must(machine, "StartRun", {
      run,
      basis: BASIS,
      limits: LIMITS,
      scope: { role: "lophn", assignment: ASG, apps: [] },
    }, { state_seq: seq });
  };
  return {
    clock,
    machine,
    must,
    execute,
    observe,
    read,
    restart,
    handle,
    startRun,
    close: () => Deno.remove(dir, { recursive: true }),
  };
}

function settingsAction(question: string) {
  return settingsOptionAction({
    question,
    changes: WIDTH as SettingMutation[],
    revision: 0,
    defaults_revision: "defaults-1",
  });
}

Deno.test("lophn-agent/questions#R10 [agent-I13]: a waiting group, its deadline, the answer and the apply state survive a restart", async () => {
  const ledger = await fileLedger();
  try {
    await ledger.startRun(RUN);
    const agent = agentRun(ASG, RUN);
    const group = id("qgr", 1);
    const question = id("qst", 1);
    const action = settingsAction(question);
    const deadline = new Date(NOW + 2 * HOUR).toISOString();
    const made = await ledger.must(
      agent,
      "CreateQuestionGroup",
      groupOf(1, RUN, [
        questionOf(1, {
          options: [optionOf("apply", action), optionOf("keep")],
        }),
      ], { expires_at: deadline }),
      {},
    );
    const createdSeq = (made.value.result as { created_seq: string })
      .created_seq;
    // 사람이 화면을 닫고 core가 재시작해도 묶음은 ledger에서 그대로 기다린다.
    ledger.restart();
    const pending = ledger.read(group);
    assertEquals(pending.status, "pending");
    assertEquals(pending.expires_at, deadline);
    assertEquals(
      pending.questions[0]!.options.map((one) => one.key),
      ["apply", "keep"],
    );
    assertEquals(pending.questions[0]!.answer, null);
    assertEquals(pending.questions[0]!.applied, false);
    // 재시작 전에 발급한 사람 확인은 메모리와 함께 사라진다. 침묵도 답이 아니다.
    const stale = ledger.handle(
      group,
      createdSeq,
      { kind: "option", option_key: "apply" },
      action.binding_hash,
    );
    ledger.restart();
    const answerInput = {
      group,
      created_seq: createdSeq,
      answer: { kind: "option", option_key: "apply" },
      binding_hash: action.binding_hash,
      evidence: { question, option: "apply" },
    };
    const lost = await ledger.execute(
      cred("user"),
      "AnswerQuestionAction",
      answerInput,
      { created_seq: createdSeq },
      stale,
    );
    assert(!lost.ok);
    assertEquals(ledger.read(group).status, "pending");
    // 새 확인으로 답을 접수한다. 기한 안의 답이다(원래 기한은 늘어나지 않았다).
    await ledger.must(
      cred("user"),
      "AnswerQuestionAction",
      answerInput,
      { created_seq: createdSeq },
      ledger.handle(
        group,
        createdSeq,
        answerInput.answer,
        action.binding_hash,
      ),
    );
    // 답을 접수한 뒤 동작 적용 전에 죽는다. 답은 남고 적용 완료로 보이지 않는다.
    ledger.restart();
    const answered = ledger.read(group);
    assertEquals(answered.status, "answered");
    assertEquals<unknown>(answered.questions[0]!.answer, {
      kind: "option",
      option_key: "apply",
      text_blob: null,
    });
    assertEquals(answered.expires_at, deadline);
    assertEquals(answered.questions[0]!.applied, false);
    // 적용은 설정이 소유한다. 질문 쪽에는 적용 기록이 없다.
    assertEquals(
      Number(
        ledger.observe("select count(*) as n from setting_choices")!["n"],
      ),
      0,
    );
    assertEquals(
      Number(
        ledger.observe(
          "select count(*) as n from events where type = 'QuestionAnswered'",
        )!["n"],
      ),
      1,
    );
  } finally {
    await ledger.close();
  }
});

Deno.test("lophn-agent/questions#R7 [agent-I13]: a restart does not stretch an explicit deadline of a group", async () => {
  const ledger = await fileLedger();
  try {
    await ledger.startRun(RUN);
    const agent = agentRun(ASG, RUN);
    const group = id("qgr", 1);
    const deadline = new Date(NOW + HOUR).toISOString();
    const made = await ledger.must(
      agent,
      "CreateQuestionGroup",
      groupOf(1, RUN, [questionOf(1), questionOf(2)], { expires_at: deadline }),
      {},
    );
    const createdSeq = (made.value.result as { created_seq: string })
      .created_seq;
    // 기한 직전에 재시작해도 기한은 그대로고, 경계에서 답은 받지 않는다.
    ledger.clock.advance(HOUR - 1);
    ledger.restart();
    assertEquals(ledger.read(group).expires_at, deadline);
    ledger.clock.advance(1);
    ledger.restart();
    // 일반 답은 확인 handle 없이 받으므로 기한이 지난 답은 기한 때문에만 거절된다.
    const late = await ledger.execute(
      cred("user"),
      "AnswerQuestionGroup",
      {
        group,
        created_seq: createdSeq,
        answers: [
          { question: id("qst", 1), answer: { kind: "text", text: "Late." } },
          { question: id("qst", 2), answer: { kind: "text", text: "Late." } },
        ],
      },
      { created_seq: createdSeq },
    );
    assert(!late.ok);
    if (!late.ok) assertEquals(late.error.code, "conflict");
    assertEquals(ledger.read(group).status, "pending");
    await ledger.must(
      ledger.machine,
      "ExpireQuestionGroup",
      { group, created_seq: createdSeq },
      { created_seq: createdSeq },
    );
    ledger.restart();
    const closed = ledger.read(group);
    assertEquals(closed.status, "expired");
    assertEquals(closed.questions.map((one) => one.answer), [null, null]);
  } finally {
    await ledger.close();
  }
});

Deno.test("lophn-agent/questions#R4 [agent-I13]: a group answers once for all its questions, a partial submit stores nothing and the answers survive a restart", async () => {
  const ledger = await fileLedger();
  try {
    await ledger.startRun(RUN);
    const agent = agentRun(ASG, RUN);
    const group = id("qgr", 1);
    const [one, two, three] = [id("qst", 1), id("qst", 2), id("qst", 3)];
    const made = await ledger.must(
      agent,
      "CreateQuestionGroup",
      groupOf(1, RUN, [
        questionOf(1, { options: [optionOf("a"), optionOf("b")] }),
        questionOf(2),
        questionOf(3, { options: [optionOf("x")] }),
      ]),
      {},
    );
    const createdSeq = (made.value.result as { created_seq: string })
      .created_seq;
    ledger.restart();
    const pending = ledger.read(group);
    assertEquals(pending.questions.map((question) => question.id), [
      one,
      two,
      three,
    ]);
    assertEquals(pending.questions.map((question) => question.position), [
      1,
      2,
      3,
    ]);
    // 일부 질문만 답한 Submit은 거절되고 아무것도 저장하지 않는다.
    const partial = await ledger.execute(
      cred("user"),
      "AnswerQuestionGroup",
      {
        group,
        created_seq: createdSeq,
        answers: [{
          question: one,
          answer: { kind: "option", option_key: "a" },
        }],
      },
      { created_seq: createdSeq },
    );
    assert(!partial.ok);
    if (!partial.ok) assertEquals(partial.error.code, "invalid_input");
    ledger.restart();
    const still = ledger.read(group);
    assertEquals(still.status, "pending");
    assertEquals(still.questions.map((question) => question.answer), [
      null,
      null,
      null,
    ]);
    assertEquals(
      Number(
        ledger.observe(
          "select count(*) as n from events where type = 'QuestionAnswered'",
        )!["n"],
      ),
      0,
    );
    // 모든 질문에 답한 Submit 한 번이 묶음 전체를 닫는다.
    const submit = {
      group,
      created_seq: createdSeq,
      answers: [
        { question: three, answer: { kind: "option", option_key: "x" } },
        { question: one, answer: { kind: "option", option_key: "b" } },
        { question: two, answer: { kind: "text", text: "Free text." } },
      ],
    };
    const done = await ledger.must(
      cred("user"),
      "AnswerQuestionGroup",
      submit,
      { created_seq: createdSeq },
    );
    ledger.restart();
    const answered = ledger.read(group);
    assertEquals(answered.status, "answered");
    assertEquals(answered.questions.map((question) => question.answer?.kind), [
      "option",
      "text",
      "option",
    ]);
    assertEquals(
      answered.questions.map((question) => question.answer?.option_key ?? null),
      ["b", null, "x"],
    );
    // 답 event는 묶음 하나에 한 번이고 질문마다의 답을 질문 순서로 싣는다.
    const events = Number(
      ledger.observe(
        "select count(*) as n from events where type = 'QuestionAnswered'",
      )!["n"],
    );
    assertEquals(events, 1);
    const payload = JSON.parse(String(
      ledger.observe(
        "select payload from events where type = 'QuestionAnswered'",
      )!["payload"],
    )) as { answers: { question: string }[] };
    assertEquals(payload.answers.map((entry) => entry.question), [
      one,
      two,
      three,
    ]);
    // 같은 Submit의 재전송은 저장된 결과만 돌려주고 다른 답은 conflict다(R9).
    const replay = await ledger.must(
      cred("user"),
      "AnswerQuestionGroup",
      submit,
      { created_seq: createdSeq },
    );
    assertEquals(
      (replay.value.result as { replayed: boolean }).replayed,
      true,
    );
    assertEquals(
      (replay.value.result as { closed_seq: string }).closed_seq,
      (done.value.result as { closed_seq: string }).closed_seq,
    );
    const other = await ledger.execute(
      cred("user"),
      "AnswerQuestionGroup",
      {
        ...submit,
        answers: submit.answers.map((entry) =>
          entry.question === one
            ? { ...entry, answer: { kind: "option", option_key: "a" } }
            : entry
        ),
      },
      { created_seq: createdSeq },
    );
    assert(!other.ok);
    if (!other.ok) assertEquals(other.error.code, "conflict");
    assertEquals(
      ledger.read(group).questions[0]!.answer?.option_key,
      "b",
    );
  } finally {
    await ledger.close();
  }
});
