import { z } from "zod";
import { manualClock, ok } from "../../../../base/mod.ts";
import { ACTOR_KINDS, defineCommand } from "../../../../protocol/server/mod.ts";
import type { LedgerTestRegistration } from "../../../testing/ledger.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "../../assignments/mod.ts";
import {
  createRunCommands,
  createRunReads,
  deleteSessionRuns,
  runSchemaSteps,
} from "../../run-loop/mod.ts";
import {
  conversationSchemaSteps,
  createConversationCommands,
  createConversationReads,
  hasUnappliedSteering,
} from "../../session/mod.ts";
import { registerMessageBodyRef } from "../../session/testing/mod.ts";
import { toolsSchemaSteps } from "../mod.ts";
import { revertSchemaSteps } from "../../session/rewind/mod.ts";
import { registerQuestionTextRef } from "./testing/mod.ts";
import {
  createQuestionCommands,
  createQuestionReads,
  deleteSessionQuestions,
  questionSchemaSteps,
} from "./mod.ts";

// 질문 ledger 테스트 등록. preset·assignment·run 표와 같은 wire에 질문 명령·읽기를
// 붙이고, 질문의 기한 경계를 보려고 시계를 이 등록이 쥔다(AdvanceQuestionClock으로만
// 앞으로 간다). StartRun이 읽는 한도 설정 표는 platform/settings의 저장 선택 표와 같은
// 모양으로만 둔다. 실제 provider를 부르지 않는다.

const CLOCK_START = Date.UTC(2026, 0, 1);

const advanceClockRoute = defineCommand({
  resource: "question-fixture",
  method: "advance-clock",
  name: "AdvanceQuestionClock",
  input: z.strictObject({ ms: z.number().int().min(0) }),
  output: z.strictObject({ now: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

// 세션을 여는 자리(project)는 그 concern이 남긴 생성 event로 확인한다. 이 시험은 그 event만 심는다.
const seedProjectRoute = defineCommand({
  resource: "project-fixture",
  method: "seed",
  name: "SeedProject",
  input: z.strictObject({ id: z.string() }),
  output: z.strictObject({ id: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

const seedSettingChoiceRoute = defineCommand({
  resource: "setting-choice-fixture",
  method: "seed",
  name: "SeedSettingChoice",
  input: z.strictObject({ key: z.string(), value: z.unknown() }),
  output: z.strictObject({ key: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const clock = manualClock(CLOCK_START);
  const assignmentCommands = createAssignmentCommands();
  const assignmentReads = createAssignmentReads();
  const runCommands = createRunCommands({ hasUnappliedSteering });
  const runReads = createRunReads();
  // 세션·메시지는 일반 사람 말이 질문의 답이 되지 않는지 보는 데 쓴다(R6). 접수는 제품
  // 조립과 같이 run-loop의 AcceptRun을 같은 Tx에서 부른다.
  const conversationCommands = createConversationCommands({
    // 제품 조립과 같다. 질문 묶음은 run을 가리키므로 run 기록보다 먼저 지운다.
    // 본문 참조 지움은 platform 몫이고 core 시험(packages/core/testing)이 본다.
    deleteSessionRecords: (tx, session) => {
      const keepRefs = () => ok(undefined);
      const questions = deleteSessionQuestions(tx, session, keepRefs);
      return questions.ok
        ? deleteSessionRuns(tx, session, keepRefs)
        : questions;
    },
    eraseBlobRefs: () => ok(undefined),
    acceptRun: (tx, ctx, input, compare) =>
      runCommands.accept.handle(
        tx,
        { ...ctx, actor: "machine" },
        input,
        compare,
      ),
  });
  const conversationReads = createConversationReads();
  const commands = createQuestionCommands();
  const reads = createQuestionReads();
  return {
    clock,
    // 질문 글의 참조 등록과, 같은 세션에 사람 말을 받는 시험의 본문 참조 등록이 필요하다.
    registerBlobRef: (tx, ctx, reference) =>
      reference.owner_kind === "question"
        ? registerQuestionTextRef(tx, ctx, reference)
        : registerMessageBodyRef(tx, ctx, reference),
    schemaSteps: [
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      ...conversationSchemaSteps,
      ...toolsSchemaSteps,
      ...revertSchemaSteps,
      ...questionSchemaSteps,
      {
        id: "questions.test.setting-choices",
        sql:
          "create table setting_choices (layer text not null check (layer = 'common'), key text not null, value json not null, primary key (layer, key))",
      },
    ],
    commands: [
      assignmentCommands.createBuiltin,
      assignmentCommands.createAppEngineer,
      assignmentCommands.createOperator,
      assignmentCommands.pause,
      assignmentCommands.resume,
      assignmentCommands.withdraw,
      runCommands.accept,
      runCommands.start,
      runCommands.checkpoint,
      runCommands.finish,
      runCommands.stop,
      runCommands.confirmNext,
      conversationCommands.open,
      conversationCommands.close,
      conversationCommands.receive,
      commands.create,
      commands.answer,
      commands.answerAction,
      commands.defer,
      commands.cancel,
      commands.expire,
    ],
    testCommands: [
      {
        route: advanceClockRoute,
        handle(_tx, _ctx, input) {
          clock.advance((input as { ms: number }).ms);
          return ok({ now: clock.now() });
        },
      },
      {
        route: seedProjectRoute,
        handle(tx, _ctx, input) {
          const seeded = input as { id: string };
          tx.sql.run(
            `insert into events (type, subject, actor, run, payload, at)
             values ('ProjectCreated', ?, 'machine', null, '{}', ?)`,
            [seeded.id, tx.now()],
          );
          return ok({ id: seeded.id });
        },
      },
      {
        route: seedSettingChoiceRoute,
        handle(tx, _ctx, input) {
          const seeded = input as { key: string; value: unknown };
          tx.sql.run(
            "insert into setting_choices (layer, key, value) values ('common', ?, ?) on conflict (layer, key) do update set value = excluded.value",
            [seeded.key, JSON.stringify(seeded.value)],
          );
          return ok({ key: seeded.key });
        },
      },
    ],
    reads: [
      assignmentReads.read,
      assignmentReads.list,
      runReads.read,
      runReads.list,
      runReads.result,
      conversationReads.session,
      conversationReads.messages,
      reads.read,
      reads.list,
    ],
  };
}
