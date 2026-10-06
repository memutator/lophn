import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  type LophnError,
  manualClock,
  ok,
  seededRandom,
} from "../../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  BlobRefRegistration,
  SettingMutation,
} from "../../../packages/contracts/platform/mod.ts";
import { applyMigrations } from "../../../packages/platform/backup-and-migration/mod.ts";
import {
  defineTxPort,
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runAdmission,
  runCommand,
} from "../../../packages/platform/ledger/mod.ts";
import {
  confirmationBridge,
  ConfirmationRegistry,
} from "../../../packages/platform/identity/mod.ts";
import {
  createPresetCommands,
  presetSchemaSteps,
} from "../../../packages/lophn-agent/presets/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../../../packages/lophn-agent/assignments/mod.ts";
import {
  createRunCommands,
  runSchemaSteps,
} from "../../../packages/lophn-agent/harness/run-loop/mod.ts";
import {
  presetDefinitionJson,
  presetValidateDeps,
} from "../../../packages/lophn-agent/harness/run-loop/testing/mod.ts";
import {
  createQuestionCommands,
  createQuestionReads,
  questionSchemaSteps,
  settingsOptionAction,
} from "../../../packages/lophn-agent/questions/mod.ts";
import {
  agentRun,
  cred,
  hashOf,
  id,
} from "../../../packages/lophn-agent/questions/testing/mod.ts";

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
      ...presetSchemaSteps,
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
  const presets = createPresetCommands(presetValidateDeps());
  const assignments = createAssignmentCommands();
  const runs = createRunCommands({ hasUnappliedSteering: () => false });
  const questions = createQuestionCommands();
  const commands = [
    presets.registerDefault,
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
    question: string,
    createdSeq: string,
    answer: unknown,
    bindingHash: string,
  ) => {
    const issued = registry.issue({
      type: "confirmation_handle_register",
      window_id: "win-1",
      target_ref: question,
      content_hash: hashOf({
        question,
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
  const read = (question: string) =>
    reopen((snapshot) => {
      const found = createQuestionReads().read.handle(
        snapshot,
        cred("user"),
        { question },
      );
      assert(found.ok, found.ok ? "" : JSON.stringify(found.error));
      return found.value.question;
    });
  const machine = cred("machine");
  const definition = presetDefinitionJson("lophn");
  await must(machine, "RegisterDefaultPreset", {
    id: id("pst", 1),
    definition,
    definition_hash: hashOf(definition),
  }, {});
  await must(machine, "CreateBuiltinAssignment", {
    id: ASG,
    preset: id("pst", 1),
    preset_revision: 1,
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

function option(key: string, action: unknown = null) {
  return {
    key,
    label: `Option ${key}`,
    description: `Description of ${key}`,
    evidence: [],
    adoption: null,
    action,
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

function questionInput(
  n: number,
  run: string,
  extra: Record<string, unknown>,
) {
  return {
    id: id("qst", n),
    run,
    session: null,
    prompt: `Prompt ${n}`,
    reason: `Reason ${n}`,
    options: [],
    recommendation: null,
    expires_at: null,
    ...extra,
  };
}

Deno.test("lophn-agent/questions#R10: a waiting question, its deadline, the answer and the apply state survive a restart", async () => {
  const ledger = await fileLedger();
  try {
    await ledger.startRun(RUN);
    const agent = agentRun(ASG, RUN);
    const question = id("qst", 1);
    const action = settingsAction(question);
    const deadline = new Date(NOW + 2 * HOUR).toISOString();
    const made = await ledger.must(
      agent,
      "CreateQuestion",
      questionInput(1, RUN, {
        options: [option("apply", action), option("keep")],
        expires_at: deadline,
      }),
      {},
    );
    const createdSeq = (made.value.result as { created_seq: string })
      .created_seq;
    // 사람이 화면을 닫고 core가 재시작해도 질문은 ledger에서 그대로 기다린다.
    ledger.restart();
    const pending = ledger.read(question);
    assertEquals(pending.status, "pending");
    assertEquals(pending.expires_at, deadline);
    assertEquals(pending.options.map((one) => one.key), ["apply", "keep"]);
    assertEquals(pending.answer, null);
    assertEquals(pending.applied, false);
    // 재시작 전에 발급한 사람 확인은 메모리와 함께 사라진다. 침묵도 답이 아니다.
    const stale = ledger.handle(
      question,
      createdSeq,
      { kind: "option", option_key: "apply" },
      action.binding_hash,
    );
    ledger.restart();
    const answerInput = {
      question,
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
    assertEquals(ledger.read(question).status, "pending");
    // 새 확인으로 답을 접수한다. 기한 안의 답이다(원래 기한은 늘어나지 않았다).
    await ledger.must(
      cred("user"),
      "AnswerQuestionAction",
      answerInput,
      { created_seq: createdSeq },
      ledger.handle(
        question,
        createdSeq,
        answerInput.answer,
        action.binding_hash,
      ),
    );
    // 답을 접수한 뒤 동작 적용 전에 죽는다. 답은 남고 적용 완료로 보이지 않는다.
    ledger.restart();
    const answered = ledger.read(question);
    assertEquals(answered.status, "answered");
    assertEquals<unknown>(answered.answer, {
      kind: "option",
      option_key: "apply",
      text_blob: null,
    });
    assertEquals(answered.expires_at, deadline);
    assertEquals(answered.applied, false);
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

Deno.test("lophn-agent/questions#R7: a restart does not stretch an explicit deadline", async () => {
  const ledger = await fileLedger();
  try {
    await ledger.startRun(RUN);
    const agent = agentRun(ASG, RUN);
    const question = id("qst", 1);
    const deadline = new Date(NOW + HOUR).toISOString();
    const made = await ledger.must(
      agent,
      "CreateQuestion",
      questionInput(1, RUN, { expires_at: deadline }),
      {},
    );
    const createdSeq = (made.value.result as { created_seq: string })
      .created_seq;
    // 기한 직전에 재시작해도 기한은 그대로고, 경계에서 답은 받지 않는다.
    ledger.clock.advance(HOUR - 1);
    ledger.restart();
    assertEquals(ledger.read(question).expires_at, deadline);
    ledger.clock.advance(1);
    ledger.restart();
    // 일반 답은 확인 handle 없이 받으므로 기한이 지난 답은 기한 때문에만 거절된다.
    const late = await ledger.execute(
      cred("user"),
      "AnswerQuestion",
      {
        question,
        created_seq: createdSeq,
        answer: { kind: "text", text: "Too late." },
      },
      { created_seq: createdSeq },
    );
    assert(!late.ok);
    if (!late.ok) assertEquals(late.error.code, "conflict");
    assertEquals(ledger.read(question).status, "pending");
    await ledger.must(
      ledger.machine,
      "ExpireQuestion",
      { question, created_seq: createdSeq },
      { created_seq: createdSeq },
    );
    ledger.restart();
    const closed = ledger.read(question);
    assertEquals(closed.status, "expired");
    assertEquals(closed.answer, null);
  } finally {
    await ledger.close();
  }
});
